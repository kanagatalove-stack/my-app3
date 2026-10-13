import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # --- popup (natural size ~320px wide) ---
        pg = await b.new_page(viewport={"width":520,"height":900}, device_scale_factor=2)
        await pg.goto("file:///home/user/webapp/build_assets/mock_popup.html", wait_until="networkidle")
        await pg.wait_for_timeout(800)
        el = await pg.query_selector("body > div")
        await el.screenshot(path="build_assets/popup_native.png")
        # --- lock screen (1280x800) ---
        pg2 = await b.new_page(viewport={"width":1280,"height":800}, device_scale_factor=1)
        await pg2.goto("file:///home/user/webapp/extension/lock.html", wait_until="networkidle")
        await pg2.wait_for_timeout(800)
        await pg2.screenshot(path="build_assets/lock_screen.png")
        await b.close()

asyncio.run(main())
