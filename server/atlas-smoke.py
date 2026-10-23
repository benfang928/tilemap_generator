"""Browser regression checks: python server/atlas-smoke.py (local server on PORT/5173)."""
import base64
import gzip
import io
import json
import os
import struct
from pathlib import Path

from PIL import Image
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


def verify_baked_terrain(lib_bytes, map_bytes, expected_url, project, artifact):
    version, count, animations = struct.unpack_from("<iii", lib_bytes)
    assert version == 3 and animations == 0
    frames = []
    for index in range(count):
        offset = struct.unpack_from("<i", lib_bytes, 12 + index * 4)[0]
        width, height, ox, oy, sx, sy, shadow, length = struct.unpack_from("<hhhhhhBi", lib_bytes, offset)
        assert (width, height, ox, oy, sx, sy, shadow) == (96, 64, 0, 0, 0, 0, 0)
        pixels = gzip.decompress(lib_bytes[offset + 17:offset + 17 + length])
        assert len(pixels) == width * height * 4
        frames.append(Image.frombytes("RGBA", (width, height), pixels, "raw", "BGRA"))
    assert map_bytes[:4] == bytes([1, 0, 0x43, 0x23])
    cols, rows = struct.unpack_from("<hh", map_bytes, 4)
    assert (cols, rows) == (2 + (project["cols"] + 1) // 2 * 2, 2 + (project["rows"] + 1) // 2 * 2)
    assert len(map_bytes) == 8 + cols * rows * 26
    reconstructed = Image.new("RGBA", (cols * 48, rows * 32))
    anchors = 0
    for x in range(cols):
        for y in range(rows):
            offset = 8 + (x * rows + y) * 26
            library, back, middle_library, middle, front_library, front = struct.unpack_from("<hihhhh", map_bytes, offset)
            source_x, source_y = x - 2, y - 2
            inside = 0 <= source_x < project["cols"] and 0 <= source_y < project["rows"]
            index = source_y * project["cols"] + source_x
            collision = project["collision"][index] if inside else 1
            assert bool(back & 0x20000000) == (collision == 1), (x, y, "collision")
            assert middle_library == -1 and middle == (-32768 if collision == 2 else 0)
            assert (front_library >= 0 and front > 0) == (inside and project["front"][index] >= 0)
            frame = (back & 0x1FFFFFFF) - 1
            if frame < 0:
                assert library == -1
                continue
            assert x > 0 and y > 0 and x % 2 == 0 and y % 2 == 0, (x, y, "anchor")
            assert library == 0 and frame < len(frames)
            reconstructed.paste(frames[frame], (x * 48, y * 32))
            anchors += 1
    source = Image.open(io.BytesIO(base64.b64decode(expected_url.split(",", 1)[1]))).convert("RGBA")
    assert source.size == (project["cols"] * 48, project["rows"] * 32)
    expected = Image.new("RGBA", reconstructed.size)
    expected.paste(source, (96, 64))
    reconstructed.save(OUT / artifact)
    assert reconstructed.tobytes() == expected.tobytes(), "Lib/map terrain pixels differ from web PNG or padding is not transparent"
    return {"source": [project["cols"], project["rows"]], "export": [cols, rows], "frames": count,
            "anchors": anchors, "pixels": cols * 48 * rows * 32}


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
    capture_download = lambda download: map_downloads.append(download)
    page.on("download", capture_download)
    with page.expect_download(predicate=lambda download: download.suggested_filename.endswith(".map")):
        page.locator("#btnExportMap").click()
    page.remove_listener("download", capture_download)
    assert [d.suggested_filename for d in map_downloads[:2]] == ["Tiles.Lib", "Objects.Lib"]
    assert map_downloads[2].suggested_filename.endswith(".map")
    for download in map_downloads:
        destination = OUT / download.suggested_filename
        download.save_as(str(destination))
        assert destination.stat().st_size > 100
    saved = json.loads((OUT / "export.json").read_text(encoding="utf-8"))
    spans = [(o["spanX"], o["spanY"]) for o in saved["objects"]]
    ground = page.evaluate("""() => {const p=MG.Store.project;
      return MG.Render.renderToCanvas({...p,front:new Int16Array(p.cols*p.rows).fill(-1)},1).toDataURL();}""")
    baked_export = verify_baked_terrain((OUT / "Tiles.Lib").read_bytes(),
                                      (OUT / map_downloads[2].suggested_filename).read_bytes(), ground, saved,
                                      "baked-terrain-reconstructed.png")

    # Odd source dimensions must retain their last row/column and transparent tails.
    odd_export = page.evaluate("""async () => {
      const source=MG.Store.project;
      const p={...source,name:'odd-bake',cols:5,rows:3,objects:[],
        back:Int16Array.from({length:15},(_,i)=>[0,4,8,12][(i+Math.floor(i/5))%4]),
        front:new Int16Array(15).fill(-1),collision:Uint8Array.from({length:15},(_,i)=>i%3),_terrainCache:new Map()};
      const ensure=MG.Store.ensure,download=MG.U.download,files=[];
      try {
        MG.Store.ensure=()=>p;MG.U.download=(name,data)=>files.push({name,data});
        await MG.Exporters.mapFile();
        const encoded=await Promise.all(files.map(async ({name,data})=>({name,url:await new Promise((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(data);})})));
        return {files:encoded,ground:MG.Render.renderToCanvas(p,1).toDataURL(),
          project:{cols:p.cols,rows:p.rows,front:Array.from(p.front),collision:Array.from(p.collision)}};
      } finally {MG.Store.ensure=ensure;MG.U.download=download;}
    }""")
    odd_files = {item["name"]: base64.b64decode(item["url"].split(",", 1)[1]) for item in odd_export["files"]}
    odd_baked_export = verify_baked_terrain(odd_files["Tiles.Lib"], odd_files["odd-bake.map"],
                                          odd_export["ground"], odd_export["project"], "baked-terrain-odd.png")

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

    # Real Canvas coverage checks preserve semantic centers, narrow connections and seams.
    coverage = page.evaluate("""() => {
      const colors=['#186830','#1840d8','#a86c30','#686878'];
      const tiles=colors.map((color,i)=>{const canvas=MG.U.mkCanvas(96,64);
        const ctx=MG.U.ctx(canvas);ctx.fillStyle=color;ctx.fillRect(0,0,96,64);
        return {id:'coverage-'+i,kind:['floor','water','path','wall'][i],canvas};});
      const cases=[
        ['isolated water',1,[[2,2]]],
        ['vertical water',1,[[2,1],[2,2],[2,3]]],
        ['horizontal path',2,[[1,2],[2,2],[3,2]]],
        ['path elbow',2,[[2,1],[2,2],[3,2]]],
        ['water hole',1,Array.from({length:25},(_,i)=>[i%5,Math.floor(i/5)]).filter(([x,y])=>x!==2||y!==2)],
        ['diagonal water',1,[[2,2],[3,3]]],
        ['map corner',1,[[0,0]]],
        ['isolated rock',3,[[2,2]]]
      ];
      const board=MG.U.mkCanvas(720,552),bc=MG.U.ctx(board);
      bc.fillStyle='#20252a';bc.fillRect(0,0,board.width,board.height);
      bc.font='14px sans-serif';
      let centers=0,seamPixels=0;
      const pixel=(canvas,x,y)=>Array.from(MG.U.ctx(canvas).getImageData(x,y,1,1).data);
      const expected=colors.map((color)=>[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),255]);
      const equal=(a,b)=>a.every((value,i)=>value===b[i]);
      const projects=[];
      for(let c=0;c<cases.length;c++){
        const [name,kind,cells]=cases[c];
        const p={cols:5,rows:5,tiles,objects:[],back:new Int16Array(25),front:new Int16Array(25).fill(-1),collision:new Uint8Array(25)};
        for(const [x,y] of cells)p.back[y*5+x]=kind;
        projects.push(p);
        const rendered=MG.Render.renderToCanvas(p,1);
        for(let y=0;y<5;y++)for(let x=0;x<5;x++){
          const image=MG.Render.terrainImage(p,x,y);
          if(!equal(pixel(image,24,16),expected[p.back[y*5+x]]))throw new Error(name+' lost terrain center');
          if(!equal(pixel(rendered,x*48+24,y*32+16),expected[p.back[y*5+x]]))throw new Error(name+' PNG center differs');
          centers++;
          if(x<4){const right=MG.Render.terrainImage(p,x+1,y);
            for(let py=0;py<32;py++){if(!equal(pixel(image,47,py),pixel(right,0,py)))throw new Error(name+' horizontal seam');seamPixels++;}}
          if(y<4){const below=MG.Render.terrainImage(p,x,y+1);
            for(let px=0;px<48;px++){if(!equal(pixel(image,px,31),pixel(below,px,0)))throw new Error(name+' vertical seam');seamPixels++;}}
        }
        const bx=c%3*240,by=Math.floor(c/3)*184;
        bc.fillStyle='#fff';bc.fillText(name,bx+8,by+17);bc.drawImage(rendered,bx,by+24);
      }
      for(const [index,axis] of [[1,'vertical'],[2,'horizontal']]){
        const p=projects[index],kind=cases[index][1];
        for(const [x,y] of cases[index][2]){const image=MG.Render.terrainImage(p,x,y);
          for(let t=0;t<(axis==='vertical'?32:48);t++){
            const gx=axis==='vertical'?24:t,gy=axis==='vertical'?t:16;
            // Check the whole connection where another same-kind cell touches it.
            if((axis==='vertical'&&y===2)||(axis==='horizontal'&&x===2)){
              if(!equal(pixel(image,gx,gy),expected[kind]))throw new Error(axis+' strip lost opaque core');
            }
          }
        }
      }
      const isolated=projects[0],before=MG.Render.terrainImage(isolated,2,2);
      isolated.back[7]=1;
      const after=MG.Render.terrainImage(isolated,2,2);
      if(before===after||!equal(pixel(after,24,0),expected[1])||equal(pixel(before,24,0),pixel(after,24,0)))throw new Error('neighbor edit did not refresh coverage');
      isolated.back[7]=0;
      if(!equal(pixel(MG.Render.terrainImage(isolated,2,2),24,0),pixel(before,24,0)))throw new Error('restoring neighbor did not restore coverage');
      return {cases:cases.length,centers,seamPixels,cacheRefresh:true,pngCenters:true,image:board.toDataURL()};
    }""")
    (OUT / "terrain-coverage-cases.png").write_bytes(base64.b64decode(coverage.pop("image").split(",", 1)[1]))
    assert coverage["cases"] == 8 and coverage["centers"] == 200, coverage
    assert coverage["seamPixels"] == 12800 and coverage["cacheRefresh"] and coverage["pngCenters"], coverage

    # Simulated provider failure tests the real UI -> AI -> proxy request chain.
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="networkidle")
    page.evaluate("""() => {document.querySelector('#aiKey').value='test-key';document.querySelector('#aiBase').value='https://example.test/v1';}""")
    calls = []
    image_downloads = []
    page.route("https://unreachable.example/test.png", lambda route: route.abort())
    def fail_second(route):
        if route.request.method == "GET":
            image_downloads.append(route.request.url)
            route.fulfill(status=200, content_type="image/png", body=base64.b64decode(sheets["tiles"].split(",", 1)[1]))
            return
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
    assert len(image_downloads) == 1
    assert "4 columns by 4 rows" in calls[0]["prompt"]
    assert "4 columns by 2 rows" in calls[1]["prompt"]
    assert page.evaluate("!!MG.Store.project.atlas.tileURL && !MG.Store.project.atlas.objectURL")
    assert "出错" in page.locator("#conceptStatus").inner_text()
    page.unroute("**/proxy?**", fail_second)
    page.unroute("https://unreachable.example/test.png")
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
    print(json.dumps({"result": "PASS", "materials": {"tiles": 16, "objects": 8}, "pixelFixtures": "PASS", "terrainCoverage": coverage, "bakedTerrain": [baked_export, odd_baked_export], "saveLoad": "PASS", "paintUndoExport": "PASS", "partialFailureRetry": "PASS", "legacyImport": "PASS", "pageErrors": errors}, ensure_ascii=False))
    browser.close()
