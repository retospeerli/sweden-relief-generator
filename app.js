(() => {
"use strict";

const STAC_URL = "https://api.lantmateriet.se/stac-hojd/v1";
const MAX_GRID_CELLS = 1_800_000;
const MAX_GRID_SIDE = 1800;

proj4.defs("EPSG:3006","+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs");
const WGS84 = "EPSG:4326";
const SWEREF = "EPSG:3006";

const $ = id => document.getElementById(id);
const els = {
  username:$("username"), password:$("password"), loginBtn:$("loginBtn"),
  collectionRow:$("collectionRow"), collectionSelect:$("collectionSelect"), authStatus:$("authStatus"),
  drawBtn:$("drawBtn"), clearBtn:$("clearBtn"), selectionInfo:$("selectionInfo"),
  rotation:$("rotation"), rotationValue:$("rotationValue"), realWidth:$("realWidth"), realHeight:$("realHeight"),
  applySizeBtn:$("applySizeBtn"), modelWidth:$("modelWidth"), modelHeight:$("modelHeight"),
  baseThickness:$("baseThickness"), verticalExaggeration:$("verticalExaggeration"),
  targetResolution:$("targetResolution"), mapScale:$("mapScale"), applyScaleBtn:$("applyScaleBtn"),
  buildBtn:$("buildBtn"), progressWrap:$("progressWrap"), progressBar:$("progressBar"),
  progressText:$("progressText"), result:$("result"), resultInfo:$("resultInfo"), downloadBtn:$("downloadBtn"),
  log:$("log")
};

let credentials = null;
let map, selectionLayer=null, centerMarker=null;
let drawMode=false, drawStart=null, dragBox=null;
let selection = {
  centerXY: proj4(WGS84, SWEREF, [15.0,62.0]),
  widthM:1000,
  heightM:1000,
  rotationDeg:0
};
let latestStlBlob = null;

function log(msg){
  const t = new Date().toLocaleTimeString("de-CH");
  els.log.textContent += `[${t}] ${msg}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}
function setProgress(pct, text){
  els.progressWrap.classList.remove("hidden");
  els.progressBar.style.width = `${Math.max(0,Math.min(100,pct))}%`;
  els.progressText.textContent = text;
}
function authHeaders(){
  if(!credentials) throw new Error("Nicht mit Lantmäteriet verbunden.");
  const raw = `${credentials.username}:${credentials.password}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for(const b of bytes) bin += String.fromCharCode(b);
  return {Authorization:`Basic ${btoa(bin)}`};
}
async function fetchAuth(url, options={}){
  const headers = {...authHeaders(), ...(options.headers||{})};
  const r = await fetch(url,{...options,headers});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r;
}
function f(n,d=1){return Number(n).toLocaleString("de-CH",{maximumFractionDigits:d})}

function initMap(){
  map = L.map("map",{zoomControl:true}).setView([62.0,15.0],5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap-Mitwirkende'
  }).addTo(map);

  map.on("mousedown", onMapMouseDown);
  map.on("mousemove", onMapMouseMove);
  map.on("mouseup", onMapMouseUp);
  renderSelection();
}
function projectedToLatLng(xy){
  const [lon,lat] = proj4(SWEREF,WGS84,xy);
  return [lat,lon];
}
function latLngToProjected(ll){
  return proj4(WGS84,SWEREF,[ll.lng,ll.lat]);
}
function selectionCornersProjected(sel=selection){
  const a = sel.rotationDeg*Math.PI/180;
  const ca=Math.cos(a), sa=Math.sin(a);
  const hw=sel.widthM/2, hh=sel.heightM/2;
  const local=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  return local.map(([u,v])=>[
    sel.centerXY[0] + u*ca - v*sa,
    sel.centerXY[1] + u*sa + v*ca
  ]);
}
function renderSelection(){
  const latlngs = selectionCornersProjected().map(projectedToLatLng);
  if(selectionLayer) selectionLayer.setLatLngs(latlngs);
  else selectionLayer = L.polygon(latlngs,{color:"#d92929",weight:2,fillOpacity:.10}).addTo(map);

  const c = projectedToLatLng(selection.centerXY);
  if(centerMarker) centerMarker.setLatLng(c);
  else {
    centerMarker = L.marker(c,{draggable:true,title:"Auswahl verschieben"}).addTo(map);
    centerMarker.on("drag", e=>{
      selection.centerXY = latLngToProjected(e.target.getLatLng());
      renderSelection();
    });
    centerMarker.on("dragend", updateSelectionInfo);
  }
  els.realWidth.value=Math.round(selection.widthM);
  els.realHeight.value=Math.round(selection.heightM);
  els.rotation.value=selection.rotationDeg;
  els.rotationValue.textContent=selection.rotationDeg;
  updateSelectionInfo();
}
function updateSelectionInfo(){
  const scaleX = selection.widthM / (Number(els.modelWidth.value)/1000);
  const scaleY = selection.heightM / (Number(els.modelHeight.value)/1000);
  els.selectionInfo.textContent =
    `${f(selection.widthM,0)} × ${f(selection.heightM,0)} m · Drehung ${f(selection.rotationDeg,0)}° · `+
    `entspricht ca. 1:${f((scaleX+scaleY)/2,0)}`;
}
function onMapMouseDown(e){
  if(!drawMode) return;
  L.DomEvent.preventDefault(e.originalEvent);
  map.dragging.disable();
  drawStart=e.latlng;
  if(dragBox){map.removeLayer(dragBox);dragBox=null}
}
function onMapMouseMove(e){
  if(!drawMode||!drawStart) return;
  const bounds=L.latLngBounds(drawStart,e.latlng);
  if(dragBox) dragBox.setBounds(bounds);
  else dragBox=L.rectangle(bounds,{color:"#d92929",weight:1,dashArray:"5,5",fillOpacity:.05}).addTo(map);
}
function onMapMouseUp(e){
  if(!drawMode||!drawStart) return;
  const a=latLngToProjected(drawStart), b=latLngToProjected(e.latlng);
  const width=Math.abs(b[0]-a[0]), height=Math.abs(b[1]-a[1]);
  if(width>5&&height>5){
    selection.centerXY=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    selection.widthM=width;
    selection.heightM=height;
    selection.rotationDeg=0;
    renderSelection();
    fitSelection();
  }
  drawMode=false;
  drawStart=null;
  map.dragging.enable();
  map.getContainer().classList.remove("selection-draw-mode");
  els.drawBtn.textContent="Auswahl zeichnen";
  if(dragBox){map.removeLayer(dragBox);dragBox=null}
}
function fitSelection(){
  if(selectionLayer) map.fitBounds(selectionLayer.getBounds(),{padding:[30,30]});
}

async function login(){
  const username=els.username.value.trim(), password=els.password.value;
  if(!username||!password){alert("Benutzername und Passwort/Token eingeben.");return}
  credentials={username,password};
  els.loginBtn.disabled=true;
  els.authStatus.textContent="Verbinde …";
  try{
    const r=await fetchAuth(`${STAC_URL}/collections`);
    const data=await r.json();
    const collections=data.collections||[];
    if(!collections.length) throw new Error("Keine Collections gefunden.");

    els.collectionSelect.innerHTML="";
    for(const c of collections){
      const opt=document.createElement("option");
      opt.value=c.id;
      opt.textContent=`${c.title||c.id} [${c.id}]`;
      const text=`${c.id} ${c.title||""} ${c.description||""}`.toLowerCase();
      opt.dataset.score = String(
        (text.includes("markhöjd")||text.includes("markhojd")?10:0)+
        (text.includes("dtm")?8:0)+
        (text.includes("grid")?5:0)-
        (text.includes("dsm")?8:0)-
        (text.includes("laser")||text.includes("copc")?4:0)
      );
      els.collectionSelect.appendChild(opt);
    }
    const opts=[...els.collectionSelect.options].sort((a,b)=>Number(b.dataset.score)-Number(a.dataset.score));
    if(opts[0]) els.collectionSelect.value=opts[0].value;
    els.collectionRow.classList.remove("hidden");
    els.authStatus.textContent=`Verbunden · ${collections.length} Collections`;
    log(`STAC verbunden. ${collections.length} Collections gefunden. Vorauswahl: ${els.collectionSelect.value}`);
  }catch(err){
    credentials=null;
    els.authStatus.textContent=`Fehler: ${err.message}`;
    log(`Anmeldung fehlgeschlagen: ${err.message}`);
  }finally{els.loginBtn.disabled=false}
}

function applySize(){
  const w=Number(els.realWidth.value), h=Number(els.realHeight.value);
  if(!(w>0&&h>0)) return;
  selection.widthM=w; selection.heightM=h;
  renderSelection(); fitSelection();
}
function applyScale(){
  const scale=Number(els.mapScale.value);
  const mw=Number(els.modelWidth.value), mh=Number(els.modelHeight.value);
  if(!(scale>0&&mw>0&&mh>0)){alert("Massstab sowie Modellbreite/-höhe eingeben.");return}
  selection.widthM = mw/1000*scale;
  selection.heightM = mh/1000*scale;
  renderSelection(); fitSelection();
}
function selectionWgs84Bbox(){
  const ll=selectionCornersProjected().map(projectedToLatLng);
  const lats=ll.map(p=>p[0]), lons=ll.map(p=>p[1]);
  return [Math.min(...lons),Math.min(...lats),Math.max(...lons),Math.max(...lats)];
}
function selectionProjectedBbox(){
  const pts=selectionCornersProjected();
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
function pickGeoTiffAsset(item){
  const assets=item.assets||{};
  const ranked=Object.entries(assets).map(([key,a])=>{
    const href=a.href||"";
    const type=(a.type||"").toLowerCase();
    const title=(a.title||"").toLowerCase();
    let score=0;
    if(type.includes("geotiff"))score+=20;
    if(/\.tiff?(\?|$)/i.test(href))score+=15;
    if(type.includes("image/tiff"))score+=10;
    if(key.toLowerCase().includes("data"))score+=4;
    if(title.includes("höjd")||title.includes("height")||title.includes("grid"))score+=3;
    if(/json|xml|gpkg|geojson/i.test(type+href))score-=30;
    return {key,a,score};
  }).sort((x,y)=>y.score-x.score);
  return ranked[0]&&ranked[0].score>0?ranked[0].a:null;
}
async function searchItems(){
  const collection=els.collectionSelect.value;
  if(!collection) throw new Error("Keine Höhendaten-Collection gewählt.");
  const body={bbox:selectionWgs84Bbox(),collections:[collection],limit:100};
  const r=await fetchAuth(`${STAC_URL}/search`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await r.json();
  const items=data.features||[];
  const withAssets=items.map(item=>({item,asset:pickGeoTiffAsset(item)})).filter(x=>x.asset);
  if(!withAssets.length){
    throw new Error(`Keine GeoTIFF-Assets für die Auswahl gefunden. Collection: ${collection}`);
  }
  return withAssets;
}

async function openCog(asset){
  const headers=authHeaders();
  return await GeoTIFF.fromUrl(asset.href,{headers});
}
function intersects(a,b){
  return !(a[2]<=b[0]||a[0]>=b[2]||a[3]<=b[1]||a[1]>=b[3]);
}
function buildGridSpec(){
  let res=Number(els.targetResolution.value)||2;
  let nx=Math.floor(selection.widthM/res)+1;
  let ny=Math.floor(selection.heightM/res)+1;
  const cells=()=>nx*ny;
  if(nx>MAX_GRID_SIDE||ny>MAX_GRID_SIDE||cells()>MAX_GRID_CELLS){
    const minRes=Math.max(selection.widthM/(MAX_GRID_SIDE-1),selection.heightM/(MAX_GRID_SIDE-1),
      Math.sqrt(selection.widthM*selection.heightM/MAX_GRID_CELLS));
    res=Math.max(res,minRes);
    nx=Math.floor(selection.widthM/res)+1;
    ny=Math.floor(selection.heightM/res)+1;
    log(`Raster automatisch auf ${res.toFixed(2)} m reduziert, damit der Browser stabil bleibt.`);
  }
  return {res,nx,ny};
}
function gridWorldXY(i,j,spec){
  const u = -selection.widthM/2 + i*(selection.widthM/(spec.nx-1));
  const v =  selection.heightM/2 - j*(selection.heightM/(spec.ny-1));
  const a=selection.rotationDeg*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
  return [
    selection.centerXY[0] + u*ca - v*sa,
    selection.centerXY[1] + u*sa + v*ca
  ];
}
function bilinear(data,w,h,px,py,nodata){
  if(px<0||py<0||px>w-1||py>h-1) return NaN;
  const x0=Math.floor(px), y0=Math.floor(py), x1=Math.min(x0+1,w-1), y1=Math.min(y0+1,h-1);
  const fx=px-x0, fy=py-y0;
  const vals=[data[y0*w+x0],data[y0*w+x1],data[y1*w+x0],data[y1*w+x1]];
  if(vals.some(v=>!Number.isFinite(v)||(nodata!=null&&v===nodata))) return NaN;
  const a=vals[0]*(1-fx)+vals[1]*fx;
  const b=vals[2]*(1-fx)+vals[3]*fx;
  return a*(1-fy)+b*fy;
}

async function fillGridFromCogs(found,spec){
  const z=new Float32Array(spec.nx*spec.ny);
  z.fill(NaN);
  const aoi=selectionProjectedBbox();
  let processed=0;

  for(let idx=0;idx<found.length;idx++){
    const {item,asset}=found[idx];
    setProgress(15+55*(idx/found.length),`COG ${idx+1}/${found.length} lesen …`);
    log(`Öffne ${item.id} · ${asset.href}`);
    try{
      const tiff=await openCog(asset);
      const image=await tiff.getImage();
      const bbox=image.getBoundingBox();
      if(!intersects(bbox,aoi)){processed++;continue}

      const iw=image.getWidth(), ih=image.getHeight();
      const xres=(bbox[2]-bbox[0])/iw, yres=(bbox[3]-bbox[1])/ih;
      const ix0=Math.max(0,Math.floor((aoi[0]-bbox[0])/xres)-2);
      const ix1=Math.min(iw,Math.ceil((aoi[2]-bbox[0])/xres)+2);
      const iy0=Math.max(0,Math.floor((bbox[3]-aoi[3])/yres)-2);
      const iy1=Math.min(ih,Math.ceil((bbox[3]-aoi[1])/yres)+2);
      if(ix1<=ix0||iy1<=iy0){processed++;continue}

      const arr=await image.readRasters({window:[ix0,iy0,ix1,iy1],samples:[0],interleave:true});
      const rw=ix1-ix0, rh=iy1-iy0;
      const nodata=image.getGDALNoData();

      const subMinX=bbox[0]+ix0*xres;
      const subMaxY=bbox[3]-iy0*yres;

      for(let j=0;j<spec.ny;j++){
        for(let i=0;i<spec.nx;i++){
          const gi=j*spec.nx+i;
          if(Number.isFinite(z[gi])) continue;
          const [x,y]=gridWorldXY(i,j,spec);
          if(x<bbox[0]||x>bbox[2]||y<bbox[1]||y>bbox[3]) continue;
          const px=(x-subMinX)/xres-0.5;
          const py=(subMaxY-y)/yres-0.5;
          const val=bilinear(arr,rw,rh,px,py,nodata);
          if(Number.isFinite(val)) z[gi]=val;
        }
      }
      processed++;
    }catch(err){
      log(`WARNUNG ${item.id}: ${err.message}`);
    }
  }

  let missing=0,min=Infinity,max=-Infinity;
  for(const v of z){
    if(!Number.isFinite(v)) missing++;
    else{if(v<min)min=v;if(v>max)max=v}
  }
  return {z,missing,min,max,processed};
}

function stlBinary(grid,spec){
  const nx=spec.nx, ny=spec.ny, z=grid.z;
  const mw=Number(els.modelWidth.value), mh=Number(els.modelHeight.value);
  const base=Number(els.baseThickness.value), vex=Number(els.verticalExaggeration.value);
  const sx=mw/(nx-1), sy=mh/(ny-1);
  const horizontalScale=((mw/selection.widthM)+(mh/selection.heightM))/2;
  const elevScale=horizontalScale*vex;
  const topZ=k=>base+(z[k]-grid.min)*elevScale;

  const topTris=2*(nx-1)*(ny-1);
  const sideEdges=2*(nx-1)+2*(ny-1);
  const triCount=topTris+2*sideEdges+2;
  const buffer=new ArrayBuffer(84+triCount*50);
  const view=new DataView(buffer);
  const enc=new TextEncoder();
  const header=enc.encode("Sweden Relief STL Generator · Lantmateriet");
  new Uint8Array(buffer,0,Math.min(80,header.length)).set(header.slice(0,80));
  view.setUint32(80,triCount,true);
  let off=84;

  function tri(a,b,c){
    view.setFloat32(off,0,true);view.setFloat32(off+4,0,true);view.setFloat32(off+8,0,true);off+=12;
    for(const p of [a,b,c]){
      view.setFloat32(off,p[0],true);view.setFloat32(off+4,p[1],true);view.setFloat32(off+8,p[2],true);off+=12;
    }
    view.setUint16(off,0,true);off+=2;
  }
  const P=(i,j)=>[i*sx,(ny-1-j)*sy,topZ(j*nx+i)];
  const B=(i,j)=>[i*sx,(ny-1-j)*sy,0];

  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const p00=P(i,j),p10=P(i+1,j),p01=P(i,j+1),p11=P(i+1,j+1);
    tri(p00,p01,p10); tri(p10,p01,p11);
  }

  // bottom
  tri([0,0,0],[mw,mh,0],[mw,0,0]);
  tri([0,0,0],[0,mh,0],[mw,mh,0]);

  // top & bottom perimeter edges
  for(let i=0;i<nx-1;i++){
    let a=P(i,0),b=P(i+1,0),ab=B(i,0),bb=B(i+1,0); tri(a,b,ab);tri(b,bb,ab);
    a=P(i,ny-1);b=P(i+1,ny-1);ab=B(i,ny-1);bb=B(i+1,ny-1); tri(a,ab,b);tri(b,ab,bb);
  }
  for(let j=0;j<ny-1;j++){
    let a=P(0,j),b=P(0,j+1),ab=B(0,j),bb=B(0,j+1); tri(a,ab,b);tri(b,ab,bb);
    a=P(nx-1,j);b=P(nx-1,j+1);ab=B(nx-1,j);bb=B(nx-1,j+1); tri(a,b,ab);tri(b,bb,ab);
  }
  return {buffer,triCount,heightMm:base+(grid.max-grid.min)*elevScale};
}

async function build(){
  if(!credentials){alert("Zuerst mit Lantmäteriet verbinden.");return}
  latestStlBlob=null;els.result.classList.add("hidden");els.buildBtn.disabled=true;els.log.textContent="";
  try{
    const spec=buildGridSpec();
    log(`Auswahl ${selection.widthM.toFixed(1)} × ${selection.heightM.toFixed(1)} m, Rotation ${selection.rotationDeg}°.`);
    log(`Zielraster ${spec.nx} × ${spec.ny} = ${(spec.nx*spec.ny).toLocaleString("de-CH")} Punkte (${spec.res.toFixed(2)} m).`);
    setProgress(5,"STAC durchsuchen …");
    const found=await searchItems();
    log(`${found.length} passende GeoTIFF-Items gefunden.`);
    setProgress(12,`${found.length} COG-Dateien gefunden.`);
    const grid=await fillGridFromCogs(found,spec);

    if(grid.missing){
      const pct=100*grid.missing/grid.z.length;
      throw new Error(`${grid.missing.toLocaleString("de-CH")} Rasterpunkte (${pct.toFixed(4)} %) fehlen. STL-Export wurde absichtlich gesperrt.`);
    }
    if(!Number.isFinite(grid.min)||!Number.isFinite(grid.max)) throw new Error("Keine gültigen Höhenwerte.");

    setProgress(78,"STL-Mesh erzeugen …");
    await new Promise(r=>setTimeout(r,20));
    const out=stlBinary(grid,spec);
    latestStlBlob=new Blob([out.buffer],{type:"model/stl"});
    setProgress(100,"Fertig.");
    els.resultInfo.innerHTML=
      `<strong>${spec.nx} × ${spec.ny} Höhenpunkte</strong><br>`+
      `Höhen: ${f(grid.min,1)}–${f(grid.max,1)} m RH 2000 · `+
      `${out.triCount.toLocaleString("de-CH")} Dreiecke · Modellhöhe ${f(out.heightMm,1)} mm`;
    els.result.classList.remove("hidden");
    log(`Fertig. Höhenbereich ${grid.min.toFixed(2)}–${grid.max.toFixed(2)} m. ${out.triCount} Dreiecke.`);
  }catch(err){
    setProgress(0,`Fehler: ${err.message}`);
    log(`FEHLER: ${err.message}`);
    console.error(err);
  }finally{els.buildBtn.disabled=false}
}
function download(){
  if(!latestStlBlob)return;
  const url=URL.createObjectURL(latestStlBlob);
  const a=document.createElement("a");
  const c=projectedToLatLng(selection.centerXY);
  a.href=url;
  a.download=`sweden_relief_${c[0].toFixed(4)}_${c[1].toFixed(4)}.stl`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

els.loginBtn.addEventListener("click",login);
els.drawBtn.addEventListener("click",()=>{
  drawMode=!drawMode;
  drawStart=null;
  els.drawBtn.textContent=drawMode?"Auf Karte ziehen …":"Auswahl zeichnen";
  map.getContainer().classList.toggle("selection-draw-mode",drawMode);
});
els.clearBtn.addEventListener("click",()=>{
  selection.centerXY=proj4(WGS84,SWEREF,[15,62]);selection.widthM=1000;selection.heightM=1000;selection.rotationDeg=0;
  renderSelection();map.setView([62,15],5);
});
els.rotation.addEventListener("input",()=>{
  selection.rotationDeg=Number(els.rotation.value);els.rotationValue.textContent=selection.rotationDeg;renderSelection();
});
els.applySizeBtn.addEventListener("click",applySize);
els.applyScaleBtn.addEventListener("click",applyScale);
els.modelWidth.addEventListener("input",updateSelectionInfo);
els.modelHeight.addEventListener("input",updateSelectionInfo);
els.buildBtn.addEventListener("click",build);
els.downloadBtn.addEventListener("click",download);

initMap();
log("Bereit. Zuerst Lantmäteriet-Zugang testen.");
})();