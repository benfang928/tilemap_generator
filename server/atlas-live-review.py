"""Review already-generated PNG sheets without making new API calls."""
import base64
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "atlas-review" / "live"

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1460, "height": 920})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(os.environ.get("ATLAS_TEST_URL", "http://127.0.0.1:5173"), wait_until="networkidle")
    page.locator("#atlasLayout").select_option("legacy")
    page.locator("#prompt").fill("手绘草原素材，草地、土路、溪流、岩地；松树、灌木、木桥与花丛")
    page.locator("#seed").fill("42")
    for selector, file in [("#fileTileSheet", "tiles.png"), ("#fileObjectSheet", "objects.png")]:
        page.locator(selector).set_input_files(str(OUT / file))
        page.wait_for_function("!MG.App.busy")
    page.locator('.step[data-step="2"]').click()
    page.locator("#btnAnalyzeAI").click()
    page.wait_for_function("!MG.App.busy")
    assert "完成" in page.locator("#analyzeStatus").inner_text()
    data = page.evaluate("""() => {
      const p=MG.Store.project;
      return {tiles:p.tiles.map(t=>({name:t.name,src:t.src})),objects:p.objects.map(o=>({name:o.name,src:o.variantsSrc[0],spanX:o.spanX,spanY:o.spanY}))};
    }""")
    assert len(data["tiles"]) == 16 and len(data["objects"]) == 8
    for kind in ["tiles", "objects"]:
        for i, asset in enumerate(data[kind]):
            (OUT / f"{kind}-{i:02}.png").write_bytes(base64.b64decode(asset.pop("src").split(",", 1)[1]))
    (OUT / "extracted-manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    page.locator('.tab[data-tab="objects"]').click()
    page.locator("#btnPreviewObjects").click()
    page.wait_for_function("MG.App.atlasType==='objects'")
    page.screenshot(path=str(OUT / "extracted-assets.png"))
    contact = page.evaluate("""() => {
      const p=MG.Store.project,c=MG.U.mkCanvas(800,480),ctx=MG.U.ctx(c);
      for(let y=0;y<480;y+=12)for(let x=0;x<800;x+=12){ctx.fillStyle=(x/12+y/12)%2?'#eee':'#fff';ctx.fillRect(x,y,12,12);}
      p.objects.forEach((o,i)=>{const sprite=o.variants[0],s=Math.min(170/sprite.width,200/sprite.height),x=i%4*200,y=Math.floor(i/4)*240;
        ctx.drawImage(sprite,x+(200-sprite.width*s)/2,y+10,sprite.width*s,sprite.height*s);
        ctx.fillStyle='#26372e';ctx.font='14px Microsoft YaHei';ctx.fillText(o.name,x+12,y+230);});
      return c.toDataURL();
    }""")
    (OUT / "transparent-objects.png").write_bytes(base64.b64decode(contact.split(",", 1)[1]))
    page.locator('.step[data-step="3"]').click()
    page.locator("#btnAssemble").click()
    page.wait_for_function("!MG.App.busy")
    assert "完成" in page.locator("#assembleStatus").inner_text()
    page.locator("#showGrid").uncheck()
    page.screenshot(path=str(OUT / "assembled-map.png"))
    project = page.evaluate("MG.Store.toJSON()")
    (OUT / "example.mgproj.json").write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
    assert not errors, errors
    print(json.dumps({"result": "PASS", "tiles": len(data["tiles"]), "objects": len(data["objects"]), "project": str(OUT / "example.mgproj.json"), "pageErrors": errors}, ensure_ascii=False))
    browser.close()
