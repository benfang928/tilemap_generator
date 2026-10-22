"""Browser regression checks: python server/atlas-smoke.py (local server on PORT/5173)."""
import base64
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "atlas-review"
OUT.mkdir(parents=True, exist_ok=True)
URL = os.environ.get("ATLAS_TEST_URL", "http://127.0.0.1:5173")


def idle(page):
    page.wait_for_function("window.MG?.App && !MG.App.busy")


def step(page, n):
    page.locator(f'.step[data-step="{n}"]').click()


def extract(page):
    step(page, 2)
    page.locator("#btnAnalyzeAI").click()
    idle(page)
    assert "完成" in page.locator("#analyzeStatus").inner_text()


def assemble(page):
    step(page, 3)
    page.locator("#btnAssemble").click()
    idle(page)
    assert "完成" in page.locator("#assembleStatus").inner_text()


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get("CHROME"))
    context = browser.new_context(viewport={"width": 1460, "height": 920}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL, wait_until="networkidle")
    page.locator("#prompt").fill("手绘丘陵草原，松树、溪流与石径")
    page.locator("#seed").fill("42")
    page.locator("#btnGenDemo").click()
    idle(page)
    assert "演示双图集已生成" in page.locator("#conceptStatus").inner_text()
    sheets = page.evaluate("({tiles:MG.Store.project.atlas.tileURL, objects:MG.Store.project.atlas.objectURL})")
    page.screenshot(path=str(OUT / "01-two-sheets.png"))

    # Drafts with sheets but no extracted assets must survive reload.
    page.locator("#btnSaveLocal").click()
    page.reload(wait_until="networkidle")
    page.wait_for_function("MG.Store.project.atlas?.objectURL && !MG.App.busy")
    assert page.evaluate("MG.Store.project.tiles.length") == 0
    assert page.evaluate("MG.Store.project.atlas.tileURL") == sheets["tiles"]
    assert page.locator("#seed").input_value() == "42"

    extract(page)
    materials = page.evaluate("""() => {
      const p=MG.Store.project;
      let edgeMismatch=0,samples=[];
      for(const kind of ['floor','path','water','wall']){const group=p.tiles.filter(t=>t.kind===kind);if(group.length<2)continue;
        const a=MG.U.ctx(group[0].canvas).getImageData(0,0,96,64).data;
        for(const tile of group.slice(1)){const b=MG.U.ctx(tile.canvas).getImageData(0,0,96,64).data;
          for(let y=0;y<64;y++)for(const x of [0,1,94,95]){const q=(y*96+x)*4;for(let c=0;c<3;c++)if(a[q+c]!==b[q+c]){edgeMismatch++;if(samples.length<4)samples.push({kind,i:tile.slotIndex,x,y,c,a:a[q+c],b:b[q+c]});}}
          for(let x=0;x<96;x++)for(const y of [0,1,62,63]){const q=(y*96+x)*4;for(let c=0;c<3;c++)if(a[q+c]!==b[q+c]){edgeMismatch++;if(samples.length<4)samples.push({kind,i:tile.slotIndex,x,y,c,a:a[q+c],b:b[q+c]});}}}}
      return {tiles:p.tiles.length, objects:p.objects.length, edgeMismatch,samples,
        sizes:p.tiles.map(t=>[t.canvas.width,t.canvas.height]),
        sprites:p.objects.map(o=>{const c=o.variants[0],d=MG.U.ctx(c).getImageData(0,0,c.width,c.height).data;
          let clear=0,solid=0;for(let i=3;i<d.length;i+=4){if(!d[i])clear++; if(d[i]>200)solid++;}
          return {clear,solid,ratio:c.width/c.height,spanRatio:o.spanX/o.spanY};})};
    }""")
    assert materials["tiles"] == 16, materials
    assert materials["objects"] == 8, materials
    assert all(size == [96, 64] for size in materials["sizes"])
    assert materials["edgeMismatch"] == 0, materials
    assert page.evaluate("MG.Render.renderToCanvas(MG.Store.project,1).width") == 48 * 48
    assert page.evaluate("MG.Render.renderToCanvas(MG.Store.project,1).height") == 48 * 32
    assert page.evaluate("MG.Render.worldSize('map').w===48*48 && MG.Render.worldSize('map').h===48*32")
    assert all(s["clear"] > 0 and s["solid"] > 50 for s in materials["sprites"])
    assert all(abs(s["spanRatio"] * 1.5 - s["ratio"]) < 0.001 for s in materials["sprites"])
    page.locator('.tab[data-tab="objects"]').click()
    assert page.locator('[data-tab-body="tiles"]').is_hidden()
    assert page.locator('[data-tab-body="objects"]').is_visible()
    page.screenshot(path=str(OUT / "02-transparent-assets.png"))

    step(page, 3)
    page.locator("#assembleMode").select_option("lake")
    page.evaluate("""() => {const v=document.querySelector('#variation');v.value='0.7';v.dispatchEvent(new Event('input'));}""")
    page.locator("#chkSeal").uncheck()
    page.locator("#chkFix").uncheck()
    assemble(page)
    first = page.evaluate("Array.from(MG.Store.project.back)")
    assert page.evaluate("MG.Store.project.front.some(i=>i>=0)")
    page.screenshot(path=str(OUT / "03-assembled-map.png"))
    assemble(page)
    assert page.evaluate("Array.from(MG.Store.project.back)") == first

    # Paint an actual on-screen cell, then undo.
    cell = page.evaluate("""() => {
      const p=MG.Store.project, x=Math.floor(p.cols/2),y=Math.floor(p.rows/2);
      const index=y*p.cols+x; MG.App.selectTile(p.back[index]===0?1:0);
      const s=MG.Render.cellToScreen(x+.5,y+.5); return {x:s.x,y:s.y};
    }""")
    box = page.locator("#view").bounding_box()
    page.mouse.click(box["x"] + cell["x"], box["y"] + cell["y"])
    assert page.evaluate("Array.from(MG.Store.project.back)") != first
    painted = page.evaluate("Array.from(MG.Store.project.back)")
    page.locator("#btnUndo").click()
    assert page.evaluate("Array.from(MG.Store.project.back)") == first
    page.locator("#btnRedo").click()
    assert page.evaluate("Array.from(MG.Store.project.back)") == painted
    page.locator("#btnUndo").click()

    # Source comparisons must disable painting until returning to the map.
    page.locator("#btnViewObjects").click()
    page.wait_for_function("MG.App.compare && !MG.Editor.active")
    page.mouse.click(box["x"] + cell["x"], box["y"] + cell["y"])
    assert page.evaluate("Array.from(MG.Store.project.back)") == first
    step(page, 4)
    assert page.evaluate("MG.Editor.active && !MG.App.compare")

    for selector, suffix in [("#btnExportPNG", ".png"), ("#btnExportProject", ".json")]:
        with page.expect_download() as event:
            page.locator(selector).click()
        download = event.value
        assert download.suggested_filename.endswith(suffix)
        destination = OUT / ("export" + suffix)
        download.save_as(str(destination))
        assert destination.stat().st_size > 100
    map_downloads = []
    page.on("download", lambda download: map_downloads.append(download))
    page.locator("#btnExportMap").click()
    page.wait_for_timeout(1000)
    assert [d.suggested_filename for d in map_downloads[:2]] == ["Tiles0.Lib", "Objects2.Lib"]
    assert map_downloads[2].suggested_filename.endswith(".map")
    for download in map_downloads:
        destination = OUT / download.suggested_filename
        download.save_as(str(destination))
        assert destination.stat().st_size > 100
    saved = json.loads((OUT / "export.json").read_text(encoding="utf-8"))
    spans = [(o["spanX"], o["spanY"]) for o in saved["objects"]]

    # Importing a project cannot replace the target of an in-flight generation.
    page.evaluate("window.importTarget=MG.Store.project; MG.App.busy=true")
    page.locator("#projectFile").set_input_files(str(OUT / "export.json"))
    page.wait_for_timeout(100)
    assert page.evaluate("MG.Store.project===window.importTarget")
    page.evaluate("MG.App.busy=false; delete window.importTarget")

    # Use the actual file import UI, then assemble without repeating extraction.
    page.locator("#projectFile").set_input_files(str(OUT / "export.json"))
    page.wait_for_function("MG.App.step===4 && MG.Store.project.tiles.length===16 && !MG.App.busy")
    assert page.evaluate("MG.Store.project.objects.map(o=>[o.spanX,o.spanY])") == [list(s) for s in spans]
    assert page.locator("#variation").input_value() == "0.7"
    assert page.locator("#variationVal").inner_text() == "0.70"
    assert not page.locator("#chkSeal").is_checked()
    assert not page.locator("#chkFix").is_checked()
    # The first stroke after loading must also be undoable.
    page.evaluate("MG.App.selectTile(MG.Store.project.back[Math.floor(MG.Store.project.rows/2)*MG.Store.project.cols+Math.floor(MG.Store.project.cols/2)]===0?1:0)")
    page.mouse.click(box["x"] + cell["x"], box["y"] + cell["y"])
    assert page.evaluate("Array.from(MG.Store.project.back)") != first
    page.locator("#btnUndo").click()
    assert page.evaluate("Array.from(MG.Store.project.back)") == first
    assemble(page)
    assert page.evaluate("Array.from(MG.Store.project.back)") == first
    page.locator("#btnSaveLocal").click()
    page.reload(wait_until="networkidle")
    page.wait_for_function("MG.App.step===4 && MG.Store.project.atlas?.objectURL")
    assert page.locator("#variation").input_value() == "0.7"
    assert page.locator("#variationVal").inner_text() == "0.70"
    assert not page.locator("#chkSeal").is_checked()
    assert not page.locator("#chkFix").is_checked()
    assemble(page)
    assert page.evaluate("Array.from(MG.Store.project.back)") == first

    # Extraction is atomic and invalidates stale indices/history.
    extract(page)
    assert page.evaluate("MG.Store.project.back.every(i=>i===-1) && MG.Store.history.stack.length===0")

    # Pixel fixtures exercise grid boundaries and actual alpha, rather than mocking canvas.
    fixture = page.evaluate("""async () => {
      const plan=MG.Atlas.plan({biome:'grassland',seed:1});
      const tiles=MG.U.mkCanvas(103,103),tc=MG.U.ctx(tiles);
      for(let i=0;i<16;i++){tc.fillStyle=`rgb(${20+i*12},80,40)`;const x=i%4,y=Math.floor(i/4);
        tc.fillRect(Math.floor(x*103/4),Math.floor(y*103/4),Math.floor((x+1)*103/4)-Math.floor(x*103/4),Math.floor((y+1)*103/4)-Math.floor(y*103/4));}
      const objects=MG.U.mkCanvas(400,200),oc=MG.U.ctx(objects);
      oc.fillStyle='#ff00ff';oc.fillRect(0,0,400,200);
      for(let i=0;i<8;i++){oc.fillStyle='#207020';oc.fillRect(i%4*100+30,Math.floor(i/4)*100+10,40,80);}
      const options={plan,tileURL:tiles.toDataURL(),objectURL:objects.toDataURL(),tileWidth:48,tileHeight:32};
      const a=await MG.Atlas.extract(options);
      const centers=a.tiles.map(t=>Array.from(MG.U.ctx(t.canvas).getImageData(24,16,1,1).data));
      // Already-transparent uploaded sprites must preserve opaque black content.
      oc.clearRect(0,0,400,200);oc.fillStyle='#000';for(let i=0;i<8;i++)oc.fillRect(i%4*100+30,Math.floor(i/4)*100+10,40,80);
      const b=await MG.Atlas.extract({...options,objectURL:objects.toDataURL()});
      oc.clearRect(0,0,400,200);oc.fillStyle='#ff00ff';oc.fillRect(0,0,400,200);
      const blank=await MG.Atlas.extract({...options,objectURL:objects.toDataURL()});
      return {centers, tileSizes:a.tiles.map(t=>[t.canvas.width,t.canvas.height]), count:a.objects.length, blackCount:b.objects.length,
        ratios:a.objects.map(o=>o.spanX/o.spanY), blankCount:blank.objects.length, warnings:blank.warnings.length};
    }""")
    assert fixture["count"] == fixture["blackCount"] == 8, fixture
    assert all(size == [48, 32] for size in fixture["tileSizes"]), fixture
    assert all(c == [20 + i * 12, 80, 40, 255] for i, c in enumerate(fixture["centers"])), fixture
    assert all(abs(r * 1.5 - 44 / 84) < 0.001 for r in fixture["ratios"]), fixture
    assert fixture["blankCount"] == 0 and fixture["warnings"] == 8, fixture

    # Simulated provider failure tests the real UI -> AI -> proxy request chain.
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="networkidle")
    page.evaluate("""() => {document.querySelector('#aiKey').value='test-key';document.querySelector('#aiBase').value='https://example.test/v1';}""")
    calls = []
    def fail_second(route):
        body = route.request.post_data_json
        calls.append(body)
        if len(calls) == 1:
            route.fulfill(status=200, json={"data": [{"url": "https://unreachable.example/test.png", "b64_json": sheets["tiles"].split(",", 1)[1]}]})
        else:
            route.fulfill(status=502, json={"error": {"message": "fixture provider failure"}})
    page.route("**/proxy?**", fail_second)
    page.locator("#btnGenBoth").click()
    idle(page)
    assert len(calls) == 2
    assert "4 columns by 4 rows" in calls[0]["prompt"]
    assert "4 columns by 2 rows" in calls[1]["prompt"]
    assert page.evaluate("!!MG.Store.project.atlas.tileURL && !MG.Store.project.atlas.objectURL")
    assert "出错" in page.locator("#conceptStatus").inner_text()
    page.unroute("**/proxy?**", fail_second)
    page.route("**/proxy?**", lambda route: route.fulfill(status=200, json={"data": [{"b64_json": sheets["objects"].split(",", 1)[1]}]}))
    page.locator("#btnGenObjects").click()
    idle(page)
    assert page.evaluate("!!MG.Store.project.atlas.tileURL && !!MG.Store.project.atlas.objectURL")
    assert page.evaluate("MG.Store.project.atlas.tileURL") == sheets["tiles"]
    extract(page)
    assemble(page)
    step(page, 1)
    page.locator("#btnGenObjects").click()
    idle(page)
    assert page.evaluate("MG.Store.project.tiles.length===0 && MG.Store.project.back.every(i=>i===-1) && MG.Store.history.stack.length===0")

    # Old projects retain their map and remain editable.
    legacy = dict(saved)
    legacy.pop("atlas", None)
    legacy_path = OUT / "legacy-fixture.json"
    legacy_path.write_text(json.dumps(legacy), encoding="utf-8")
    page.locator("#projectFile").set_input_files(str(legacy_path))
    page.wait_for_function("MG.App.step===4 && MG.Store.project.atlas===null")
    assert page.evaluate("Array.from(MG.Store.project.back)") == first
    assert not errors, errors
    print(json.dumps({"result": "PASS", "materials": {"tiles": 16, "objects": 8}, "pixelFixtures": "PASS", "saveLoad": "PASS", "paintUndoExport": "PASS", "partialFailureRetry": "PASS", "legacyImport": "PASS", "pageErrors": errors}, ensure_ascii=False))
    browser.close()
