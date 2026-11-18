"""Browser regression checks for every public Ventry page and homepage dialog."""
import base64
import json
import time
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
wait = WebDriverWait(driver, 8)
report = {}


def js(code):
    return driver.execute_script(code)


def capture(name):
    data = driver.execute_cdp_cmd("Page.captureScreenshot", {
        "format": "png", "fromSurface": True, "captureBeyondViewport": False
    })["data"]
    (OUTPUT / name).write_bytes(base64.b64decode(data))


def open_home_section(section, width):
    """Use the responsive header instead of a redundant secondary menu."""
    if width <= 930:
        js("""document.querySelector('.mobile-nav summary').click()""")
        assert js("return document.querySelector('.mobile-nav').open")
        js(f"""document.querySelector('.mobile-nav nav a[href="#{section}"]').click()""")
        assert not js("return document.querySelector('.mobile-nav').open")
    else:
        js(f"""document.querySelector('.rail-links a[href="#{section}"]').click()""")


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
    for width, height in ((320, 760), (390, 844), (768, 1000), (1440, 900)):
        label = str(width)
        page = load("/", width, height)
        # The header provides navigation at every width. A second page-level
        # menu beneath the hero must not duplicate those same four links.
        assert not js("return !!document.querySelector('.chapter-strip')"), "Duplicate section navigation under hero"
        # Company content should not restate the three principles in Approach.
        assert not js("return !!document.querySelector('[data-panel=about] .company-side')"), "Company duplicates Approach principles"
        header_selector = ".mobile-top" if width <= 930 else ".rail"
        assert js(f"""return getComputedStyle(document.querySelector('{header_selector}')).display !== 'none'"""), (
            "Primary responsive header is hidden", width
        )
        artwork = js("""const r=document.querySelector('.identity-object').getBoundingClientRect();
          return {left:r.left,right:r.right,width:r.width,height:r.height}""")
        assert artwork["width"] >= 150 and artwork["height"] >= 150, ("Brand artwork is too small", width, artwork)
        assert artwork["left"] >= -1 and artwork["right"] <= width + 1, ("Brand artwork clipped", width, artwork)
        empty_band = js("""const hero=document.querySelector('.opening').getBoundingClientRect();
          const footer=document.querySelector('.reach-footer').getBoundingClientRect();
          return Math.round(footer.top - hero.bottom)""")
        assert empty_band <= 28, ("Large blank area between hero and footer", width, empty_band)
        home_height = js("return Math.ceil(document.documentElement.scrollHeight)")
        assert home_height < max(1100, height + 150), ("home page too tall", width, home_height)
        if width == 1440:
            assert home_height <= height + 2, ("Desktop homepage scrolls for no reason", home_height, height)
        capture(f"ui-{label}-home.png")

        open_home_section("projects", width)
        wait.until(lambda _: js("return document.querySelector('#section-dialog').open"))
        if width <= 390:
            sheet_bottom = js("""return document.querySelector('#section-dialog').getBoundingClientRect().bottom""")
            assert abs(sheet_bottom - height) <= 3, ("Mobile dialog is not a bottom sheet", width, sheet_bottom)

        wait.until(lambda _: js("""return (i=>i.complete&&i.naturalWidth>0)(document.querySelector('[data-panel="projects"] img'))"""))
        assert js("return location.hash") == "#projects"
        if width in (390, 1440):
            capture(f"ui-{label}-projects.png")
        js("""document.querySelector('.dialog-tabs a[href="#about"]').click()""")
        assert not js("""return document.querySelector('[data-panel="about"]').hidden""")
        assert js("return location.hash") == "#about"
        if width == 390:
            capture("ui-390-company.png")
        js("""document.querySelector('.dialog-tabs a[href="#method"]').click()""")
        assert not js("""return document.querySelector('[data-panel="method"]').hidden""")
        js("""document.querySelector('.method-entries details:nth-of-type(2) summary').click()""")
        assert js("""return document.querySelector('.method-entries details:nth-of-type(2)').open""")
        js("""document.querySelector('.dialog-tabs a[href="#contact"]').click()""")
        if width == 390:
            capture("ui-390-contact.png")
        js("""document.querySelector('[data-close-dialog]').click()""")
        wait.until(lambda _: not js("return document.querySelector('#section-dialog').open") and not js("return location.hash"))
        page["homeHeight"] = home_height

        product = load("/projects/raschet/", width, height)
        assert not js("return !!document.querySelector('.product-faq .all-projects')"), "Duplicate Projects backlink"
        assert js("""return document.querySelector('.ledger-balance dd').textContent.trim()""") == "2 000 ₽"
        assert js("""return document.querySelector('.product-page .product-copy h1').textContent""") == "Расчёт"
        js("""document.querySelector('.faq-list summary').click()""")
        assert js("""return document.querySelector('.faq-list details').open""")
        if width <= 768:
            driver.find_element(By.CSS_SELECTOR, ".menu-toggle").click()
            assert js("""return document.querySelector('#main-nav').classList.contains('is-open')""")
            driver.switch_to.active_element.send_keys(Keys.ESCAPE)
            assert not js("""return document.querySelector('#main-nav').classList.contains('is-open')""")
        if width in (390, 1440):
            capture(f"ui-{label}-raschet.png")

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
    initial_length = js("return history.length")
    open_home_section("about", 390)
    assert js("return history.length") == initial_length + 1
    for part in ("method", "projects", "contact"):
        js(f"""document.querySelector('.dialog-tabs a[href="#{part}"]').click()""")
        assert js("return history.length") == initial_length + 1, ("history grows on tab switches", part)
    driver.back()
    wait.until(lambda _: not js("return document.querySelector('#section-dialog').open"))
    assert not js("return location.hash"), "Back must close the dialog"
    # Closing a pushed dialog must go Back, rather than replacing its URL and
    # leaving a duplicate base-page entry on every subsequent open.
    stable_history_length = js("return history.length")
    for cycle, close_action in enumerate(("button", "escape", "start", "button")):
        open_home_section("projects", 390)
        wait.until(lambda _: js("return document.querySelector('#section-dialog').open"))
        assert js("return history.length") == stable_history_length, (
            "Repeated opening accumulated a browser-history entry", cycle
        )
        if cycle == 1:
            js("""document.querySelector('.dialog-tabs a[href="#method"]').click()""")
            assert js("return location.hash") == "#method"
        if close_action == "button":
            js("""document.querySelector('[data-close-dialog]').click()""")
        elif close_action == "escape":
            driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        else:
            js("""document.querySelector('.mobile-nav a[href="#start"]').click()""")
        wait.until(lambda _: not js("return document.querySelector('#section-dialog').open") and not js("return location.hash"))
        assert js("return history.length") == stable_history_length, (
            "Closing accumulated a browser-history entry", cycle
        )

    # Browser Forward should reopen the last modal; Back should close it.
    driver.forward()
    wait.until(lambda _: js("return document.querySelector('#section-dialog').open"))
    assert js("return location.hash") == "#projects"
    driver.back()
    wait.until(lambda _: not js("return document.querySelector('#section-dialog').open") and not js("return location.hash"))

    driver.get(BASE + "/#projects")
    assert js("""return document.querySelector('#section-dialog').open && !document.querySelector('[data-panel="projects"]').hidden""")
    direct_history_length = js("return history.length")
    js("""document.querySelector('[data-close-dialog]').click()""")
    assert not js("return location.hash")
    assert js("return history.length") == direct_history_length, "Direct hash close must not navigate Back"
    report["navigation"] = "PASS"
    (OUTPUT / "all-pages-QA.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("PASS: 4 viewports, 4 public pages, dialog image, history, focus and mobile menus",flush=True)
finally:
    driver.quit()
