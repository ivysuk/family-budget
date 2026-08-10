import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto("https://ivysuk.github.io/family-budget/", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.screenshot(path="scratch_check1.png")
    page.wait_for_timeout(8000)
    page.screenshot(path="scratch_check2.png", full_page=True)

    for tab in ["pay", "claim", "settings"]:
        page.click(f'.tab-btn[data-tab="{tab}"]')
        page.wait_for_timeout(400)
        page.screenshot(path=f"scratch_check_{tab}.png", full_page=True)

    browser.close()
print("done")
