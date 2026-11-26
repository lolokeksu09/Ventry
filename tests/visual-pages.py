"""Browser regression checks for every public Ventry page and homepage sections."""
import base64
import json
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

BASE = "http://127.0.0.1:18765"
OUTPUT = Path("artifacts")
OUTPUT.mkdir(exist_ok=True)
browser_options = Options()
for argument in ("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1440,900"):
    browser_options.add_argument(argument)
driver = webdriver.Chrome(options=browser_options)
driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
wait = WebDriverWait(driver, 8)
report = {}


def js(code):
    return driver.execute_script(code)


def capture(name):
    data = driver.execute_cdp_cmd("Page.captureScreenshot", {
        "format": "png", "fromSurface": True, "captureBeyondViewport": False
    })["data"]
    (OUTPUT / name).write_bytes(base64.b64decode(data))


SECTION_ROUTES = {"about": "/about/", "method": "/approach/", "projects": "/projects/", "contact": "/contact/"}


def open_home_section(section, width):
    route = SECTION_ROUTES[section]
    scope = ".rail-links"
    if width <= 930:
        driver.find_element(By.CSS_SELECTOR, ".mobile-nav summary").click()
        assert js("return document.querySelector('.mobile-nav').open")
        scope = ".mobile-nav nav"
    driver.find_element(By.CSS_SELECTOR, f'{scope} a[href="{route}"]').click()
    wait.until(lambda _: js("return location.pathname") == route)
    assert driver.find_element(By.CSS_SELECTOR, f'{scope} a[aria-current="page"]').get_attribute("href") == BASE + route
    assert driver.find_element(By.CSS_SELECTOR, "main h1").is_displayed()
    assert js("return document.documentElement.scrollWidth <= innerWidth")
    if width <= 930:
        assert not js("return document.querySelector('.mobile-nav').open")


def load(route, width, height):
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 800
    })
    driver.get(BASE + route)
    driver.execute_async_script("const cb=arguments[0];document.fonts.ready.then(()=>cb(true))")
    record = js("""return {
      url:location.pathname,
      width:innerWidth,
      scrollWidth:document.documentElement.scrollWidth,
      background:getComputedStyle(document.body).backgroundColor,
      h1:document.querySelectorAll('h1').length
    }""")
    assert record["width"] == width, record
    assert record["scrollWidth"] <= width, record
    assert record["h1"] == 1, record
    assert record["background"] == "rgb(5, 9, 7)", record
    return record


try:
    for width, height in ((320, 760), (360, 800), (390, 844), (430, 900), (768, 1000), (1440, 900)):
        label = str(width)
        page = load("/", width, height)
        header_selector = ".mobile-top" if width <= 930 else ".rail"
        assert driver.find_element(By.CSS_SELECTOR, header_selector).is_displayed()
        assert js("""return [...document.querySelectorAll('main > section')].map(s => s.id)""") == [
            "start", "about", "method", "projects", "contact"
        ]
        assert not js("return !!document.querySelector('dialog, .chapter-strip')")
        assert len(driver.find_elements(By.CSS_SELECTOR, ".principle-list li")) == 3
        assert js("return document.querySelector('.opening-actions a.hero-secondary').pathname") == "/projects/"
        assert js("return !!document.querySelector('#projects .demo-note')")
        composition = js("""const hero = document.querySelector('.opening').getBoundingClientRect();
          return {
            heroHeight: Math.round(hero.height),
            gapAfterActions: Math.round(hero.bottom - document.querySelector('.opening-actions').getBoundingClientRect().bottom),
            aboutTop: Math.round(document.querySelector('#about').getBoundingClientRect().top),
            brandShape: document.querySelector('.identity-construction use').getAttribute('href'),
            ctas: [...document.querySelectorAll('.opening-actions a')].map(a => Math.round(a.getBoundingClientRect().height))
          }""")
        assert composition["gapAfterActions"] <= 110, (width, composition)
        assert composition["aboutTop"] < height, (width, composition)
        assert composition["brandShape"] == "#ventry-brand-shape", (width, composition)
        assert all(h >= 44 for h in composition["ctas"]), (width, composition)
        page["composition"] = composition
        capture(f"ui-{label}-home.png")

        for section in ("about", "method", "projects", "contact"):
            open_home_section(section, width)
            if section == "method":
                principles = driver.find_elements(By.CSS_SELECTOR, ".principle-list li p")
                assert len(principles) == 3 and all(p.is_displayed() for p in principles)
            if section == "projects":
                wait.until(lambda _: js("""return document.querySelector('#projects img').naturalWidth > 0"""))
                assert js("""return document.querySelector('#projects .work-item a[href="/projects/raschet/"]').pathname""") == "/projects/raschet/"
            if section == "contact":
                topics = driver.find_elements(By.CSS_SELECTOR, ".contact-topics li a")
                assert len(topics) == 3
                assert all(a.get_attribute("href").startswith("mailto:ventrybusinesswork@gmail.com?subject=") for a in topics)
            if width in (390, 1440):
                capture(f"ui-{label}-{section}.png")

        product = load("/projects/raschet/", width, height)
        assert not js("return !!document.querySelector('.product-faq .all-projects')"), "Duplicate Projects backlink"
        assert js("""return document.querySelector('.ledger-balance dd').textContent.trim()""") == "2 350 ₽"
        assert js("""return document.querySelector('.product-page .product-copy h1').textContent""") == "Расчёт"
        assert len(driver.find_elements(By.CSS_SELECTOR, ".android-feature-list dt")) == 4
        screenshots = driver.find_elements(By.CSS_SELECTOR, ".android-gallery-grid img")
        assert len(screenshots) == 3
        js("document.querySelectorAll('.android-gallery-grid img').forEach(img => img.loading = 'eager')")
        wait.until(lambda _: js("return [...document.querySelectorAll('.android-gallery-grid img')].every(img => img.complete && img.naturalWidth === 540 && img.naturalHeight === 1200)"))
        assert js("return [...document.querySelectorAll('.android-gallery-grid a')].every(a => a.getAttribute('href') === a.querySelector('img').getAttribute('src'))")
        assert js("return document.documentElement.scrollWidth <= innerWidth")
        assert driver.find_element(By.CSS_SELECTOR, ".preview-note").is_displayed()
        assert len(driver.find_elements(By.CSS_SELECTOR, ".work-summary")) == 0
        assert js("return document.querySelector('.product-next a.primary-button').pathname") == "/raschet/"
        js("""document.querySelector('.faq-list summary').click()""")
        assert js("""return document.querySelector('.faq-list details').open""")
        if width <= 768:
            driver.find_element(By.CSS_SELECTOR, ".menu-toggle").click()
            assert js("""return document.querySelector('#main-nav').classList.contains('is-open')""")
            driver.switch_to.active_element.send_keys(Keys.ESCAPE)
            assert not js("""return document.querySelector('#main-nav').classList.contains('is-open')""")
        if width in (390, 1440):
            capture(f"ui-{label}-raschet.png")
            js("document.querySelector('.android-gallery').scrollIntoView({block: 'start', behavior: 'instant'})")
            capture(f"ui-{label}-android-gallery.png")
            js("window.scrollTo({top:0,behavior:'instant'})")

        for route, headings in (
            ("/legal/", ["legal-status", "legal-contact", "legal-service", "legal-data"]),
            ("/privacy/", ["privacy-owner", "privacy-scope", "privacy-data", "privacy-grounds", "privacy-services", "privacy-retention", "privacy-rights", "privacy-protection"]),
        ):
            record = load(route, width, height)
            links = js("""return [...document.querySelectorAll('.document-toc a')].map(a=>a.getAttribute('href').slice(1))""")
            assert links == headings, (route, links)
            first = driver.find_element(By.CSS_SELECTOR, ".document-toc a")
            first.click()
            assert js("return location.hash") == "#" + headings[0]
            assert js("""return document.querySelector('h1').innerText.length>10""")
            if width in (390, 1440):
                js("window.scrollTo(0,0)")
                capture(f"ui-{label}-{route.strip('/')}.png")

        report[label] = {"home": page, "product": product}

    load("/", 390, 844)
    menu = driver.find_element(By.CSS_SELECTOR, ".mobile-nav summary")
    menu.click()
    menu.send_keys(Keys.ESCAPE)
    assert js("return !document.querySelector('.mobile-nav').open && document.activeElement === document.querySelector('.mobile-nav summary')")
    open_home_section("about", 390)
    open_home_section("projects", 390)
    driver.back()
    wait.until(lambda _: js("return location.pathname") == "/about/")
    driver.forward()
    wait.until(lambda _: js("return location.pathname") == "/projects/")

    driver.get(BASE + "/?direct=1#about")
    wait.until(lambda _: js("""const top = document.querySelector('#about h2').getBoundingClientRect().top;
      return top >= 65 && top < innerHeight;"""))
    open_home_section("contact", 390)
    driver.execute_cdp_cmd("Browser.grantPermissions", {"origin": BASE, "permissions": ["clipboardSanitizedWrite"]})
    copy = driver.find_element(By.CSS_SELECTOR, "[data-copy-email]")
    copy.click()
    wait.until(lambda _: js("return document.querySelector('#copy-email-status').textContent") == "Адрес скопирован")
    js("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
    copy.click()
    wait.until(lambda _: "вручную" in js("return document.querySelector('#copy-email-status').textContent"))
    assert js("return window.getSelection().toString()") == "ventrybusinesswork@gmail.com"

    driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": True})
    driver.get(BASE + "/?no-js=1")
    driver.find_element(By.CSS_SELECTOR, ".mobile-nav summary").click()
    driver.find_element(By.CSS_SELECTOR, '.mobile-nav nav a[href="/projects/"]').click()
    assert driver.current_url == BASE + "/projects/"
    assert driver.find_element(By.CSS_SELECTOR, "#projects .work-item").is_displayed()
    driver.get(BASE + "/contact/")
    assert not driver.find_element(By.CSS_SELECTOR, "[data-copy-email]").is_displayed()
    driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": False})

    driver.get((OUTPUT / "Ventry-ui-audit.html").resolve().as_uri())
    driver.find_element(By.CSS_SELECTOR, ".hero-primary").click()
    assert js("return location.hash") == "#about"
    # The public preview must never load or mutate legacy personal records.
    driver.get(BASE + "/raschet/")
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    legacy = '{"version":2,"clients":[{"id":"legacy","name":"Старый тест","phone":""}],"entries":[]}'
    js("localStorage.setItem('dolgbook-v1-own', " + json.dumps(legacy) + ")")
    js("localStorage.setItem('dolgbook-v1-demo', " + json.dumps(legacy) + ")")
    driver.refresh()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    assert "Старый тест" not in driver.find_element(By.ID, "clients").text
    assert not js("return !!document.querySelector('input[type=file],input[type=tel]')")
    capture("ui-390-demo.png")
    driver.find_element(By.ID, "add-client").click()
    assert js("return document.querySelector('#client-form [name=name]').readOnly")
    driver.find_element(By.ID, "client-submit").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "5")
    driver.find_element(By.ID, "demo-payment").click()
    driver.find_element(By.ID, "entry-submit").click()
    wait.until(lambda _: driver.find_element(By.ID, "demo-operation").is_displayed())
    driver.find_element(By.ID, "demo-operation").click()
    assert "2 350" in driver.find_element(By.ID, "demo-result-summary").text.replace("\\xa0", " ").replace("\\u202f", " ")
    assert js("return !!document.querySelector('#history [data-operation-id]')")
    js("document.querySelector('[data-view=statistics]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "stats-content").is_displayed())
    js("document.querySelector('#stats-period').value='all';document.querySelector('#stats-period').dispatchEvent(new Event('change'))")
    assert "7 010" in driver.find_element(By.ID, "stats-content").text.replace("\xa0", " ").replace("\u202f", " ")
    js("document.querySelector('[data-stats-client=demo-0]').click()")
    assert js("return document.querySelector('#stats-client').value") == "demo-0"
    assert "2 350" in driver.find_element(By.ID, "stats-content").text.replace("\xa0", " ").replace("\u202f", " ")
    capture("ui-390-demo-statistics.png")
    report["demo_statistics"] = "PASS"
    js("document.querySelector('[data-view=settings]').click()")
    wait.until(lambda _: not js("return document.querySelector('#legacy-export').disabled"))
    assert js("return localStorage.getItem('dolgbook-v1-own')") == legacy
    assert js("return localStorage.getItem('dolgbook-v1-demo')") == legacy
    driver.get(BASE + "/raschet/?demo=1")
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    driver.find_element(By.ID, "add-client").click()
    driver.find_element(By.ID, "client-submit").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "5")
    driver.find_element(By.ID, "switch-mode").click()
    driver.find_element(By.ID, "confirm-import").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    assert js("return localStorage.getItem('dolgbook-v1-own')") == legacy
    assert js("return localStorage.getItem('dolgbook-v1-demo')") == legacy
    report["demo_only_and_legacy_preservation"] = "PASS"
    report["navigation"] = "PASS"
    (OUTPUT / "all-pages-QA.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("PASS: 6 viewports, 8 public pages, section links, history, focus, clipboard and no-JS",flush=True)
finally:
    driver.quit()
