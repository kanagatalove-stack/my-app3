import asyncio, sys
from playwright.async_api import async_playwright

async def main():
    url = "file:///home/user/webapp/build_assets/mock_dashboard.html"
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1280,"height":800}, device_scale_factor=1)
        await pg.goto(url, wait_until="networkidle")
        await pg.wait_for_timeout(1200)
        h = await pg.evaluate("document.body.scrollHeight")
        print("body scrollHeight =", h)
        await pg.screenshot(path="build_assets/dash_full.png", full_page=True)
        await b.close()

asyncio.run(main())
