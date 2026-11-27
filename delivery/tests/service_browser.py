#!/usr/bin/env python3
"""Browser test of the actual pages, API and signed APK. Synthetic customer only."""
import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

out=Path(os.environ["RUNNER_TEMP"])/"delivery-browser"
out.mkdir(exist_ok=True)
downloads=out/"downloads"
downloads.mkdir(exist_ok=True)
release=json.loads((Path(__file__).parents[1]/"service/release.json").read_text())
secret=Path(os.environ["DELIVERY_ADMIN_TOKEN_FILE"]).read_text().strip()
options=webdriver.ChromeOptions()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1280,900"]:
    options.add_argument(arg)
options.add_experimental_option("prefs",{"download.default_directory":str(downloads),"download.prompt_for_download":False})
driver=webdriver.Chrome(options=options)
# Headless Chrome must have an explicit allowed download directory. This is a
# test-profile setting only; do not disable real-client Safe Browsing policies.
driver.execute_cdp_cmd("Browser.setDownloadBehavior",{"behavior":"allow","downloadPath":str(downloads)})
wait=WebDriverWait(driver,20)
def elem(i): return driver.find_element(By.ID,i)
def show(i): return wait.until(EC.visibility_of_element_located((By.ID,i)))
def workspace():
    # Report only the UI's sanitized message, not browser credentials or request bodies.
    def ready(d):
        return d.execute_script("""
          const w=document.getElementById('workspace'),m=document.getElementById('message');
          if (!w.hidden && !w.inert) return true;
          if (!w.inert && m.classList.contains('error')) return m.textContent;
          return false;
        """)
    result=wait.until(ready)
    assert result is True, "Admin login failed: "+str(result)

def click(i): wait.until(EC.element_to_be_clickable((By.ID,i))).click()
def fill(i,v):
    e=show(i); e.clear(); e.send_keys(v)
def idle():
    wait.until(lambda d:d.execute_script("return !document.getElementById('workspace').inert"))
def summary_for(form):
    form.find_element(By.XPATH,"ancestor::details[1]/summary").click()
def fit():
    assert driver.execute_script("return document.documentElement.scrollWidth <= window.innerWidth+1")
def screenshot(name):
    driver.save_screenshot(str(out/name))
try:
    driver.get("http://127.0.0.1:18081/")
    screenshot("01-login.png")
    fill("token",secret); elem("login-form").find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    workspace()
    form=elem("create-form")
    summary_for(form); click("new-ids")
    customer=elem("customer-id").get_attribute("value")
    sid=elem("subscription-id").get_attribute("value")
    assert len(sid)==len(customer)==36
    form.find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    show("selected"); idle()
    wait.until(lambda d:elem("selected-id").text==sid)
    assert elem("selected-status").text=="Не начата"
    form=elem("bind-form"); summary_for(form)
    fill("device-id",str(uuid4())); click("new-bind")
    form.find_element(By.CSS_SELECTOR,"button[type=submit]").click(); idle()
    wait.until(lambda d:elem("selected-device").text!="—")
    Select(elem("plan")).select_by_value("trial")
    click("new-payment"); click("confirmed")
    elem("grant-form").find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    wait.until(lambda d:elem("selected-status").text=="Активна"); idle()
    Select(elem("plan")).select_by_value("month")
    assert elem("amount").get_attribute("value")=="299.00"
    click("new-payment"); click("confirmed")
    elem("grant-form").find_element(By.CSS_SELECTOR,"button[type=submit]").click(); idle()
    wait.until(lambda d:"Начисление подтверждено" in elem("message").text)
    driver.execute_script("window.scrollTo(0,0)")
    fit(); screenshot("02-desktop.png")
    driver.set_window_size(390,844); driver.execute_script("window.scrollTo(0,0)")
    fit(); screenshot("03-mobile.png")
    driver.execute_script("document.getElementById('issue').closest('details').open=true")
    click("issue"); show("link-box"); idle()
    link=elem("download-link").get_attribute("value")
    assert len(urlsplit(link).fragment)==64
    driver.get(link); show("start")
    assert not urlsplit(driver.current_url).fragment
    screenshot("04-client-download.png")
    # Drop the response after the real server consumed the grant. Same open
    # page must recover, with no second link and no credential in storage.
    driver.execute_script("""
      const real=window.fetch.bind(window);
      let dropped=false;
      window.fetch=async (...args)=>{
        const r=await real(...args);
        if (!dropped && args[0]==='/api/v1/download' && r.ok) {
          dropped=true; await r.arrayBuffer(); throw new Error('synthetic response loss');
        }
        return r;
      };
    """)
    click("start")
    wait.until(lambda d:elem("start").is_enabled())
    assert "Повторите" in elem("status").text
    click("start"); show("save")
    assert elem("save").get_attribute("href").startswith("blob:")
    assert elem("save").get_attribute("download")=="Raschet-release-candidate.apk"
    click("save")
    apk=downloads/"Raschet-release-candidate.apk"
    try:
        WebDriverWait(driver,40).until(lambda d:apk.exists() and apk.stat().st_size==release["size"])
    except Exception:
        print("Browser download directory:",[(p.name,p.stat().st_size) for p in downloads.iterdir()])
        # Inspect only download state, never URL, token or full browser history.
        driver.get("chrome://downloads/")
        print("Browser download state:",driver.execute_script("""
          const m=document.querySelector('downloads-manager');
          const items=m?.shadowRoot?.querySelector('#downloadsList')?.items || [];
          return Array.from(items,x=>({state:x.state,dangerType:x.dangerType,
              percent:x.percent,totalBytes:x.totalBytes,receivedBytes:x.receivedBytes}));
        """))
        raise
    assert hashlib.sha256(apk.read_bytes()).hexdigest()==release["sha256"]
    driver.get(link)
    wait.until(lambda d: not urlsplit(d.current_url).fragment)
    click("start")
    wait.until(lambda d:"недоступна" in elem("status").text)
    driver.get("http://127.0.0.1:18081/")
    show("login")
    assert not elem("workspace").is_displayed()
    fill("token",secret); elem("login-form").find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    workspace()
    assert Select(elem("project-select")).first_selected_option.get_attribute("value")=="raschet"
    form=elem("project-form"); summary_for(form)
    code="browser_"+uuid4().hex[:12]
    fill("project-name","Другой проект"); fill("project-code",code); fill("project-package-input","dev.ventry."+code)
    form.find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    wait.until(lambda d:d.execute_script("return document.getElementById('project-select').value") == code); idle()
    assert elem("release-info").text=="Одобренной сборки нет."
    form=elem("project-plan-form"); summary_for(form)
    Select(elem("new-plan-code")).select_by_value("month"); fill("new-plan-amount","123")
    click("add-plan"); wait.until(EC.alert_is_present()).accept(); idle()
    wait.until(lambda d:"123" in elem("project-plans").text)
    form=elem("create-form")
    if not form.is_displayed(): summary_for(form)
    click("new-ids")
    other=elem("subscription-id").get_attribute("value")
    form.find_element(By.CSS_SELECTOR,"button[type=submit]").click()
    wait.until(lambda d:elem("selected-id").text==other); idle()
    assert elem("amount").get_attribute("value")=="123.00"
    driver.execute_script("document.getElementById('issue').closest('details').open=true")
    assert not elem("issue").is_enabled()
    click("new-payment"); click("confirmed")
    elem("grant-form").find_element(By.CSS_SELECTOR,"button[type=submit]").click(); idle()
    wait.until(lambda d:"123" in elem("metric-confirmed").text)
    fit(); screenshot("05-other-project.png")
    Select(elem("project-select")).select_by_value("raschet"); idle()
    wait.until(lambda d:"0.30.0-beta.1" in elem("release-info").text)
    assert not elem("selected").is_displayed()
    assert other not in elem("customers").text
    fill("open-id",other); elem("open-form").find_element(By.CSS_SELECTOR,"button").click(); idle()
    wait.until(lambda d:"другому проекту" in elem("message").text)
    assert not elem("selected").is_displayed()
    print("DELIVERY_BROWSER_PROJECT_CATALOG_AND_SCOPE_PASS")
    print("DELIVERY_BROWSER_SUBSCRIBE_AND_REAL_DOWNLOAD_PASS")
finally:
    driver.quit()
    # Do not publish downloaded APK or any credential in screenshot/log artifacts.
    for file in downloads.glob("*"):
        file.unlink()
