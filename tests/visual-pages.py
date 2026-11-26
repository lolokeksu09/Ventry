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


def click_visible(element_id):
    element = driver.find_element(By.ID, element_id)
    driver.execute_script("arguments[0].scrollIntoView({block:'center',inline:'nearest'})", element)
    wait.until(lambda _: driver.execute_script(
        "const r=arguments[0].getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return arguments[0].contains(hit)", element))
    element.click()


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
    if section == "about":
        assert len(driver.find_elements(By.CSS_SELECTOR, ".about-details article")) == 2
        assert js("return document.querySelector('.about-details a').pathname") == "/projects/raschet/"
        assert js("return document.querySelector('.about-actions .hero-primary').pathname") == "/raschet/"
    if section == "method":
        assert len(driver.find_elements(By.CSS_SELECTOR, ".principle-list li")) == 4
        assert js("return document.querySelector('.method-next .hero-primary').pathname") == "/projects/raschet/"
        assert js("return document.querySelector('.method-next .hero-secondary').pathname") == "/raschet/"
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
    for width, height in ((320, 760), (360, 800), (390, 844), (430, 900), (768, 1000), (900, 600), (1024, 768), (1440, 900), (1920, 1080)):
        label = str(width)
        page = load("/", width, height)
        header_selector = ".mobile-top" if width <= 930 else ".rail"
        assert driver.find_element(By.CSS_SELECTOR, header_selector).is_displayed()
        assert js("""return [...document.querySelectorAll('main > section')].map(s => s.id)""") == [
            "start", "projects", "about", "method", "contact"
        ]
        assert not js("return !!document.querySelector('dialog, .chapter-strip')")
        assert len(driver.find_elements(By.CSS_SELECTOR, ".principle-list li")) == 3
        assert js("return document.querySelector('.opening-actions a.hero-primary').pathname") == "/projects/"
        assert js("return !!document.querySelector('#projects .demo-note')")
        assert js("""const org=document.querySelector('footer[itemtype="https://schema.org/Organization"]');return !!org && org.querySelector('[itemprop="name"]').textContent==='Ventry' && org.querySelector('[itemprop="email"]').href.startsWith('mailto:')""")
        assert js("return document.querySelector('.opening-actions a.hero-secondary').pathname") == "/about/"
        assert js("return document.querySelector('#projects .work-actions a.hero-primary').pathname") == "/raschet/"
        assert js("return document.querySelector('#projects .work-item').dataset.product") == "raschet"
        assert len(driver.find_elements(By.CSS_SELECTOR, "#projects .work-features li")) == 3
        js("document.querySelector('#projects .work-preview img').loading='eager'")
        wait.until(lambda _: js("return document.querySelector('#projects .work-preview img').naturalWidth === 540"))
        assert js("return document.querySelector('#projects .work-preview>a').hash") == "#gallery-title"
        composition = js("""const hero = document.querySelector('.opening').getBoundingClientRect();
          return {
            heroHeight: Math.round(hero.height),
            gapAfterActions: Math.round(hero.bottom - document.querySelector('.opening-actions').getBoundingClientRect().bottom),
            projectTop: Math.round(document.querySelector('#projects').getBoundingClientRect().top),
            brandShape: document.querySelector('.identity-construction use').getAttribute('href'),
            ctas: [...document.querySelectorAll('.opening-actions a')].map(a => Math.round(a.getBoundingClientRect().height))
          }""")
        assert composition["gapAfterActions"] <= 110, (width, composition)
        assert composition["projectTop"] < height, (width, composition)
        assert composition["brandShape"] == "#ventry-brand-shape", (width, composition)
        assert all(h >= 44 for h in composition["ctas"]), (width, composition)
        page["composition"] = composition
        capture(f"ui-{label}-home.png")

        for section in ("about", "method", "projects", "contact"):
            open_home_section(section, width)
            if section == "method":
                principles = driver.find_elements(By.CSS_SELECTOR, ".principle-list li p")
                assert len(principles) == 4 and all(p.is_displayed() for p in principles)
            if section == "projects":
                wait.until(lambda _: js("""return document.querySelector('#projects img').naturalWidth > 0"""))
                assert js("""return document.querySelector('#projects .work-item a[href="/projects/raschet/"]').pathname""") == "/projects/raschet/"
            if section == "contact":
                topics = driver.find_elements(By.CSS_SELECTOR, ".contact-topics li a")
                assert len(topics) == 3
                assert all(a.get_attribute("href").startswith("mailto:ventrybusinesswork@gmail.com?subject=") for a in topics)
                assert driver.find_element(By.ID, "request-controls").is_displayed()
                assert js("return document.querySelector('#request-message').maxLength") == 800
                assert js("return !document.querySelector('#request-controls form')")
                assert js("return document.querySelector('#request-mail').protocol") == "mailto:"
            if width in (390, 1440):
                capture(f"ui-{label}-{section}.png")

        product = load("/projects/raschet/", width, height)
        assert not js("return !!document.querySelector('.product-faq .all-projects')"), "Duplicate Projects backlink"
        wait.until(lambda _: js("return document.querySelector('.hero-screen').complete && document.querySelector('.hero-screen').naturalWidth === 540 && document.querySelector('.hero-screen').naturalHeight === 1200"))
        assert js("return document.querySelector('.screen-dialog').open") is False
        assert js("""return document.querySelector('.product-page .product-copy h1').textContent""") == "Расчёт"
        assert js("""const app=document.querySelector('main[itemtype="https://schema.org/SoftwareApplication"]');return !!app && app.querySelector('[itemprop="name"]').textContent==='Расчёт' && app.querySelector('[itemprop="operatingSystem"]').content==='Android'""")
        assert len(driver.find_elements(By.CSS_SELECTOR, ".android-feature-list dt")) == 4
        assert js("return [...document.querySelectorAll('.scenario-grid a')].map(a=>new URL(a.href).searchParams.get('scenario'))") == ["debt","payment","deadlines","history","calendar","statistics"]
        screenshots = driver.find_elements(By.CSS_SELECTOR, ".android-gallery-grid img")
        assert len(screenshots) == 3
        js("document.querySelectorAll('.android-gallery-grid img').forEach(img => img.loading = 'eager')")
        wait.until(lambda _: js("return [...document.querySelectorAll('.android-gallery-grid img')].every(img => img.complete && img.naturalWidth === 540 && img.naturalHeight === 1200)"))
        assert js("return [...document.querySelectorAll('.android-gallery-grid a')].every(a => a.getAttribute('href') === a.querySelector('img').getAttribute('src'))")
        # All three screenshots must stay compact, side by side and fully inside the viewport.
        gallery_rects = js("""return [...document.querySelectorAll('.android-gallery-grid a')].map(a=>{const r=a.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}})""")
        assert len(gallery_rects) == 3
        assert max(r["y"] for r in gallery_rects) - min(r["y"] for r in gallery_rects) < 1, (width, gallery_rects)
        assert all(44 <= r["w"] <= 220 and r["x"] >= 0 and r["right"] <= width for r in gallery_rects), (width, gallery_rects)
        assert all(a["right"] <= b["x"] for a,b in zip(gallery_rects,gallery_rects[1:])), (width,gallery_rects)
        if width <= 620:
            assert max(r["w"] for r in gallery_rects) <= width / 3, (width,gallery_rects)
        assert js("return document.querySelectorAll('[data-screen-preview]').length") == 4
        driver.find_element(By.CSS_SELECTOR, ".hero-screen-link").click()
        wait.until(lambda _: js("return document.querySelector('#screen-dialog').open"))
        assert "долговая книга" in js("return document.querySelector('#screen-dialog-image').alt").lower()
        assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 1 из 3"
        driver.find_element(By.ID, "screen-next").click()
        assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 2 из 3"
        assert js("return document.querySelector('#screen-dialog-image').src.endsWith('/android-statistics.webp')")
        driver.switch_to.active_element.send_keys(Keys.ARROW_RIGHT)
        assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 3 из 3"
        driver.find_element(By.ID, "screen-next").click()
        assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 1 из 3"
        driver.find_element(By.ID, "screen-prev").click()
        assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 3 из 3"
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        wait.until(lambda _: not js("return document.querySelector('#screen-dialog').open"))
        wait.until(lambda _: js("return document.activeElement === document.querySelector('.hero-screen-link')"))
        driver.find_element(By.CSS_SELECTOR, ".android-gallery-grid a[data-screen-preview]").click()
        wait.until(lambda _: js("return document.querySelector('#screen-dialog').open"))
        assert "Долговая книга" in js("return document.querySelector('#screen-dialog-caption').textContent")
        assert "Общий остаток" in js("return document.querySelector('#screen-dialog-caption').textContent")
        driver.find_element(By.CSS_SELECTOR, ".screen-dialog-close").click()
        wait.until(lambda _: not js("return document.querySelector('#screen-dialog').open"))
        if width <= 620:
            third_preview = driver.find_elements(By.CSS_SELECTOR, ".android-gallery-grid a[data-screen-preview]")[2]
            driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})", third_preview)
            third_preview.click()
            wait.until(lambda _: js("return document.querySelector('#screen-dialog').open"))
            assert js("return document.querySelector('#screen-dialog-position').textContent") == "Экран 3 из 3"
            driver.find_element(By.CSS_SELECTOR, ".screen-dialog-close").click()
            wait.until(lambda _: not js("return document.querySelector('#screen-dialog').open"))
        assert js("return document.documentElement.scrollWidth <= innerWidth")
        assert driver.find_element(By.CSS_SELECTOR, ".preview-note").is_displayed()
        assert len(driver.find_elements(By.CSS_SELECTOR, ".work-summary")) == 0
        assert js("return document.querySelector('.product-next a.primary-button').pathname") == "/raschet/"
        assert js("return document.querySelector('.product-next a.quiet-button').pathname") == "/contact/"
        assert js("return document.querySelector('.product-next a.quiet-button').search") == "?topic=raschet"
        js("""document.querySelector('.faq-list summary').click()""")
        assert js("""return document.querySelector('.faq-list details').open""")
        expected_navigation = ["/", "/about/", "/approach/", "/projects/", "/support/", "/contact/"]
        assert js("return [...document.querySelectorAll('#main-nav a')].map(a=>a.pathname)") == expected_navigation
        assert js("return document.querySelector('#main-nav [aria-current=location]').pathname") == "/projects/"
        assert js("return [...document.querySelectorAll('.product-section-nav a')].map(a=>a.hash)") == ["#android-features-title", "#gallery-title", "#possibilities-title", "#next-title", "#faq-title"]
        assert js("return document.querySelectorAll('.demo-boundary-grid article').length") == 2
        gallery_link = driver.find_element(By.CSS_SELECTOR, '.product-section-nav a[href="#gallery-title"]')
        driver.execute_script("arguments[0].scrollIntoView({block:'start',behavior:'instant'})", gallery_link)
        assert driver.execute_script("""const a=arguments[0],r=a.getBoundingClientRect(),h=document.querySelector('.site-header').getBoundingClientRect();return r.top>=h.bottom && a.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))""", gallery_link)
        gallery_link.click()
        wait.until(lambda _: js("return location.hash") == "#gallery-title")
        wait.until(lambda _: js("const h=document.querySelector('#gallery-title').getBoundingClientRect();return h.top >= 72 && h.top < innerHeight"))
        js("window.scrollTo(0,0)")
        if width <= 930:
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
            assert js("return [...document.querySelectorAll('#main-nav a')].map(a=>a.pathname)") == expected_navigation
            links = js("""return [...document.querySelectorAll('.document-toc a')].map(a=>a.getAttribute('href').slice(1))""")
            assert links == headings, (route, links)
            first = driver.find_element(By.CSS_SELECTOR, ".document-toc a")
            driver.execute_script("arguments[0].scrollIntoView({block:'start',behavior:'instant'})", first)
            assert driver.execute_script("return arguments[0].getBoundingClientRect().top >= document.querySelector('.site-header').getBoundingClientRect().bottom", first)
            first.click()
            assert js("return location.hash") == "#" + headings[0]
            wait.until(lambda _: js("const h=document.getElementById(location.hash.slice(1)).getBoundingClientRect();return h.top >= 72 && h.top < innerHeight"))
            assert js("""return document.querySelector('h1').innerText.length>10""")
            if width in (390, 1440):
                js("window.scrollTo(0,0)")
                capture(f"ui-{label}-{route.strip('/')}.png")

        for route in ("/releases/", "/docs/", "/support/", "/status/"):
            resource = load(route, width, height)
            assert js("return [...document.querySelectorAll('#main-nav a')].map(a=>a.pathname)") == expected_navigation
            assert js("return [...document.querySelectorAll('.resource-tabs a')].map(a=>a.pathname)") == ["/releases/", "/docs/", "/support/", "/status/"]
            assert js("return document.querySelector('.resource-tabs [aria-current=page]').pathname") == route
            if route == "/releases/":
                assert js("return document.querySelectorAll('.release-entry a').length") == 0
                assert js("return !document.body.innerText.toLowerCase().includes('github')")
                assert js("return document.querySelectorAll('.release-changes li').length") >= 5
                assert js("return document.querySelector('.release-changes').innerText.includes('CSV и PDF')")
                assert js("return document.querySelector('.release-list').innerText.length > 10")
            elif route == "/docs/":
                assert js("return document.querySelectorAll('.guide-steps li').length") == 4
                assert js("return document.querySelectorAll('[data-knowledge-item]').length") == 5
                assert driver.find_element(By.ID, "docs-search").is_displayed()
                assert js("return document.querySelector('#backup').textContent.includes('копии')")
            elif route == "/support/":
                assert js("return document.querySelectorAll('.resource-route-grid article').length") == 3
                faq = driver.find_element(By.CSS_SELECTOR, ".resource-faq summary")
                driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})", faq)
                faq.click()
                assert js("return document.querySelector('.resource-faq details').open")
            else:
                wait.until(lambda _: js("return document.querySelectorAll('.availability-state[data-state=available]').length") == 3)
                assert js("return !document.querySelector('#availability-refresh').disabled")
            if width in (390,1440):
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

    load("/contact/?topic=support#request", 390, 844)
    assert js("return document.querySelector('#request-topic').value") == "support"
    js("document.querySelector('#request-message').value='Проверка & ? #';document.querySelector('#request-message').dispatchEvent(new Event('input'))")
    assert js("""const href=document.querySelector('#request-mail').getAttribute('href');const query=new URLSearchParams(href.split('?')[1]);return query.get('body')==='Проверка & ? #' && query.get('subject')==='Ventry: вопрос или ошибка'""")
    assert js("return document.querySelector('#request-limit').textContent") == "14 / 800 символов"
    js("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
    click_visible("request-copy")
    wait.until(lambda _: js("return !document.querySelector('#request-fallback').hidden"))
    assert "Проверка & ? #" in js("return document.querySelector('#request-text').value")
    js("document.querySelector('#request-topic').value='partner';document.querySelector('#request-topic').dispatchEvent(new Event('change'))")
    assert js("return document.querySelector('#request-fallback').hidden")
    assert js("return document.querySelector('#request-message').value") == "Проверка & ? #"
    driver.refresh()
    assert js("return document.querySelector('#request-message').value") == ""
    report["local_email_draft"] = "PASS"
    # Optional device information is included only for product/support drafts.
    load("/contact/?topic=support#request", 390, 844)
    for field, value in (("request-device", "Test & model"), ("request-android", "15"), ("request-version", "0.29")):
        driver.find_element(By.ID, field).send_keys(value)
    assert js("""const q=new URLSearchParams(document.querySelector('#request-mail').getAttribute('href').split('?')[1]);return q.get('body')==='Модель: Test & model\\r\\nAndroid: 15\\r\\nВерсия приложения: 0.29'""")
    js("document.querySelector('#request-topic').value='partner';document.querySelector('#request-topic').dispatchEvent(new Event('change'))")
    assert js("return document.querySelector('#request-context').hidden")
    assert js("""return new URLSearchParams(document.querySelector('#request-mail').getAttribute('href').split('?')[1]).get('body')===''""")
    driver.refresh()
    assert js("return document.querySelector('#request-device').value") == ""
    report["structured_local_draft"] = "PASS"

    load("/docs/",390,844)
    search = driver.find_element(By.ID,"docs-search")
    search.send_keys("JSON")
    assert js("return [...document.querySelectorAll('[data-knowledge-item]')].some(el=>!el.hidden)")
    search.clear()
    search.send_keys("no-result-7d128")
    assert js("return [...document.querySelectorAll('[data-knowledge-item]')].every(el=>el.hidden)")
    assert js("return !document.querySelector('[data-knowledge-empty]').hidden")
    js("location.hash='backup'")
    wait.until(lambda _: js("return !document.querySelector('#backup').closest('[data-knowledge-item]').hidden"))
    assert js("return document.querySelector('#docs-search').value") == ""
    load("/support/",390,844)
    filter_button = driver.find_element(By.CSS_SELECTOR, '[data-knowledge-filter="data"]')
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})",filter_button)
    filter_button.click()
    assert js("return document.querySelectorAll('[data-knowledge-item]:not([hidden])').length") == 3
    assert js("return [...document.querySelectorAll('[data-knowledge-item]:not([hidden])')].every(el=>el.dataset.knowledgeItem==='data')")
    reset = driver.find_element(By.CSS_SELECTOR, "[data-knowledge-reset]")
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})",reset)
    reset.click()
    assert js("return document.querySelectorAll('[data-knowledge-item]:not([hidden])').length") == 9
    report["knowledge_search"] = "PASS"

    # Actual HTTP responses in the local preview, then a browser network error and recovery.
    load("/status/",390,844)
    wait.until(lambda _: js("return document.querySelectorAll('.availability-state[data-state=available]').length") == 3)
    driver.execute_cdp_cmd("Network.enable", {})
    try:
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": [BASE + "/healthz"]})
        click_visible("availability-refresh")
        wait.until(lambda _: js("return !document.querySelector('#availability-refresh').disabled"))
        assert js("return document.querySelector('[data-service=health] .availability-state').dataset.state") == "unknown"
        assert js("return document.querySelectorAll('.availability-state[data-state=available]').length") == 2
    finally:
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
    click_visible("availability-refresh")
    wait.until(lambda _: js("return document.querySelectorAll('.availability-state[data-state=available]').length") == 3)
    assert js("return document.querySelector('#availability-time').textContent.includes('местное время')")
    report["availability_success_failure_retry"] = "PASS"

    driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": True})
    driver.get(BASE + "/status/")
    assert driver.find_element(By.ID, "availability-summary").text == "Проверка ещё не выполнена."
    assert not driver.find_element(By.ID, "availability-refresh").is_displayed()
    driver.get(BASE + "/docs/")
    assert driver.find_element(By.ID, "backup").is_displayed()
    assert not driver.find_element(By.ID, "docs-controls").is_displayed()
    driver.get(BASE + "/support/")
    assert driver.find_element(By.CSS_SELECTOR, ".knowledge-faq summary").is_displayed()
    driver.get(BASE + "/?no-js=1")
    driver.find_element(By.CSS_SELECTOR, ".mobile-nav summary").click()
    driver.find_element(By.CSS_SELECTOR, '.mobile-nav nav a[href="/projects/"]').click()
    assert driver.current_url == BASE + "/projects/"
    assert driver.find_element(By.CSS_SELECTOR, "#projects .work-item").is_displayed()
    driver.get(BASE + "/contact/")
    assert not driver.find_element(By.CSS_SELECTOR, "[data-copy-email]").is_displayed()
    assert not driver.find_element(By.ID, "request-controls").is_displayed()
    assert len(driver.find_elements(By.CSS_SELECTOR, ".contact-topics li a")) == 3
    driver.get(BASE + "/projects/raschet/")
    assert driver.find_element(By.CSS_SELECTOR, '#main-nav a[href="/approach/"]').is_displayed()
    assert driver.find_element(By.CSS_SELECTOR, '.product-section-nav a[href="#gallery-title"]').is_displayed()
    driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": False})

    driver.get((OUTPUT / "Ventry-ui-audit.html").resolve().as_uri())
    driver.find_element(By.CSS_SELECTOR, ".hero-primary").click()
    assert js("return location.hash") == "#projects"
    # Every public scenario is an explicit, safe entry into the demo.
    for scenario, view in (("debt","book"),("payment","book"),("deadlines","clients"),("history","history"),("calendar","book"),("statistics","statistics")):
        driver.get(BASE + "/raschet/?demo=1&scenario=" + scenario)
        wait.until(lambda _: js("return !document.querySelector('#scenario-panel').hidden"))
        assert js("return location.hash") == "#" + view
        assert js("return !document.querySelector('dialog[open]')")
        assert js("return document.querySelector('#client-count').textContent") == "4"
        assert js("return document.documentElement.scrollWidth <= innerWidth")
        click_visible("scenario-action")
        if scenario in ("debt","payment"):
            dialog = "#quick-dialog" if scenario == "debt" else "#entry-dialog"
            wait.until(lambda _: js("return document.querySelector(" + json.dumps(dialog) + ").open"))
            driver.switch_to.active_element.send_keys(Keys.ESCAPE)
            wait.until(lambda _: not js("return document.querySelector(" + json.dumps(dialog) + ").open"))
        elif scenario == "deadlines":
            assert js("return document.querySelector('[data-filter=soon]').getAttribute('aria-pressed')") == "true"
        elif scenario == "calendar":
            assert js("return !document.querySelector('#calendar-panel').hidden")
        elif scenario == "statistics":
            assert js("return document.activeElement.id") == "stats-period"
        click_visible("scenario-dismiss")
        assert js("return document.querySelector('#scenario-panel').hidden")
        assert not js("return new URLSearchParams(location.search).has('scenario')")
    driver.get(BASE + "/raschet/?demo=1&scenario=invalid&scenario=payment")
    wait.until(lambda _: js("return location.hash") == "#book")
    assert js("return document.querySelector('#scenario-panel').hidden && !document.querySelector('dialog[open]')")
    report["demo_scenarios"] = "PASS"
    # The public preview must never load or mutate legacy personal records.
    driver.get(BASE + "/raschet/")
    assert js("return [...document.querySelectorAll('.demo-site-route a')].map(a=>a.pathname)") == ["/projects/raschet/", "/contact/"]
    assert js("return document.querySelector('.demo-site-route a[href*=\"topic=raschet\"]').hash") == "#request"
    assert driver.find_element(By.CSS_SELECTOR, ".demo-site-route").is_displayed()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    legacy = '{"version":2,"clients":[{"id":"legacy","name":"Старый тест","phone":""}],"entries":[]}'
    js("localStorage.setItem('dolgbook-v1-own', " + json.dumps(legacy) + ")")
    js("localStorage.setItem('dolgbook-v1-demo', " + json.dumps(legacy) + ")")
    driver.refresh()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    assert "Старый тест" not in driver.find_element(By.ID, "clients").text
    assert not js("return !!document.querySelector('input[type=file],input[type=tel]')")
    driver.find_element(By.ID, "quick-debt").click()
    assert js("return document.querySelector('#quick-dialog').open")
    driver.find_element(By.ID, "quick-continue").click()
    assert js("return document.querySelector('#entry-dialog').open")
    driver.find_element(By.CSS_SELECTOR, "#entry-dialog [data-close]").click()
    wait.until(lambda _: not js("return document.querySelector('#entry-dialog').open"))
    assert js("return document.querySelectorAll('.sidebar nav button').length") == 4
    assert driver.find_element(By.ID, "book-statistics-entry").is_displayed()
    assert js("return document.documentElement.scrollWidth <= innerWidth")
    capture("ui-390-demo.png")
    js("document.querySelector('[data-view=clients]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "add-client").is_displayed())
    click_visible("add-client")
    assert js("return document.querySelector('#client-form [name=name]').readOnly")
    driver.find_element(By.ID, "client-submit").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "5")
    wait.until(lambda _: not js("return document.querySelector('#client-dialog').open"))
    js("document.querySelector('[data-view=book]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "demo-payment").is_displayed())
    click_visible("demo-payment")
    driver.find_element(By.ID, "entry-submit").click()
    wait.until(lambda _: driver.find_element(By.ID, "demo-operation").is_displayed())
    click_visible("demo-operation")
    assert "2 350" in driver.find_element(By.ID, "demo-result-summary").text.replace("\\xa0", " ").replace("\\u202f", " ")
    assert js("return !!document.querySelector('#history [data-operation-id]')")
    js("document.querySelector('[data-view=book]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "book-statistics-entry").is_displayed())
    click_visible("book-statistics-entry")
    wait.until(lambda _: driver.find_element(By.ID, "stats-content").is_displayed())
    js("document.querySelector('#stats-period').value='all';document.querySelector('#stats-period').dispatchEvent(new Event('change'))")
    assert "7 010" in driver.find_element(By.ID, "stats-content").text.replace("\xa0", " ").replace("\u202f", " ")
    js("document.querySelector('[data-stats-client=demo-0]').click()")
    assert js("return document.querySelector('#stats-client').value") == "demo-0"
    assert "2 350" in driver.find_element(By.ID, "stats-content").text.replace("\xa0", " ").replace("\u202f", " ")
    assert js("return !document.querySelector('#stats-csv').disabled")
    js("document.querySelector('#stats-client').value='';document.querySelector('#stats-client').dispatchEvent(new Event('change'))")
    js("document.querySelector('#stats-rank').value='debtCount';document.querySelector('#stats-rank').dispatchEvent(new Event('change'))")
    assert js("return document.querySelectorAll('[data-stats-client]').length") >= 1
    assert js("return !!document.querySelector('.chart-balance')")
    assert "Активность клиентов" in driver.find_element(By.ID, "stats-content").text
    assert js("return document.documentElement.scrollWidth <= innerWidth")
    capture("ui-390-demo-statistics.png")
    report["demo_statistics"] = "PASS"
    js("document.querySelector('[data-view=book]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "date-entries").is_displayed())
    assert js("return document.querySelectorAll('#date-entries details').length") >= 1
    click_visible("dates-payment")
    click_visible("dates-calendar")
    click_visible("calendar-today")
    assert js("return document.querySelectorAll('#date-entries [data-operation-id]').length") >= 1
    capture("ui-390-demo-calendar.png")
    report["demo_calendar"] = "PASS"
    js("document.querySelector('[data-view=settings]').click()")
    wait.until(lambda _: not js("return document.querySelector('#legacy-export').disabled"))
    assert js("return localStorage.getItem('dolgbook-v1-own')") == legacy
    assert js("return localStorage.getItem('dolgbook-v1-demo')") == legacy
    driver.get(BASE + "/raschet/?demo=1")
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    js("document.querySelector('[data-view=clients]').click()")
    wait.until(lambda _: driver.find_element(By.ID, "add-client").is_displayed())
    click_visible("add-client")
    driver.find_element(By.ID, "client-submit").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "5")
    click_visible("switch-mode")
    driver.find_element(By.ID, "confirm-import").click()
    wait.until(lambda _: js("return document.querySelector('#client-count').textContent") == "4")
    assert js("return localStorage.getItem('dolgbook-v1-own')") == legacy
    assert js("return localStorage.getItem('dolgbook-v1-demo')") == legacy
    report["demo_only_and_legacy_preservation"] = "PASS"
    report["navigation"] = "PASS"

    # Cold-cache browser laboratory samples; not production Core Web Vitals.
    observer = driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
      window.__ventryLab = {lcp_ms:null, layout_shift_sum:0};
      if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
        new PerformanceObserver(list=>{for(const e of list.getEntries())window.__ventryLab.lcp_ms=e.startTime;}).observe({type:'largest-contentful-paint', buffered:true});
      }
      if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__ventryLab.layout_shift_sum+=e.value;}).observe({type:'layout-shift', buffered:true});
      }
    """})["identifier"]
    samples = []
    driver.execute_cdp_cmd("Network.setCacheDisabled", {"cacheDisabled": True})
    try:
        for width, height in ((390,844),(1440,900)):
            for route in ("/","/projects/raschet/","/docs/","/raschet/"):
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                    "width":width,"height":height,"deviceScaleFactor":1,"mobile":width<800
                })
                driver.get(BASE+route)
                driver.execute_async_script("const done=arguments[0];document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,150))))")
                sample = js("""
                    const n=performance.getEntriesByType('navigation')[0];
                    const r=performance.getEntriesByType('resource');
                    return {route:location.pathname, width:innerWidth, requests:r.length+1,
                      third_party:r.filter(e=>new URL(e.name).origin!==location.origin).map(e=>e.name),
                      decoded_bytes:n.decodedBodySize+r.reduce((s,e)=>s+e.decodedBodySize,0),
                      transferred_bytes:n.transferSize+r.reduce((s,e)=>s+e.transferSize,0),
                      load_ms:n.loadEventEnd, fcp_ms:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,
                      ...window.__ventryLab};
                """)
                assert not sample["third_party"], sample
                assert 0 < sample["decoded_bytes"] <= 300*1024, sample
                assert sample["requests"] <= 24, sample
                samples.append(sample)
    finally:
        driver.execute_cdp_cmd("Network.setCacheDisabled", {"cacheDisabled": False})
        driver.execute_cdp_cmd("Page.removeScriptToEvaluateOnNewDocument", {"identifier": observer})
    (OUTPUT / "browser-performance.json").write_text(json.dumps({"environment":"local preview, cold browser cache, no network/CPU throttling; timings diagnostic only","samples":samples},ensure_ascii=False,indent=2),encoding="utf-8")
    report["browser_payload_budget"] = "PASS"
    (OUTPUT / "all-pages-QA.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("PASS: 9 viewports, 12 corporate pages, resource centers, availability, browser payload budgets, demo routes, history, focus, clipboard and no-JS",flush=True)
finally:
    driver.quit()
