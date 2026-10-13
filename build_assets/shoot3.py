import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1000,"height":1400}, device_scale_factor=1)
        await pg.goto("file:///home/user/webapp/docs/privacy-policy.html", wait_until="networkidle")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path="build_assets/privacy_preview.png", full_page=True)
        h = await pg.evaluate("document.body.scrollHeight")
        print("privacy page height:", h)
        await b.close()
asyncio.run(main())
