(() => {
  'use strict';
  const tour = window.AUREUM_TOUR;
  const $ = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const sceneById = new Map(tour.scenes.map(scene => [scene.id, scene]));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const viewport = $('viewport');
  const photo = $('scene-image');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let current = tour.scenes[0];
  let activeCategory = 'all';
  let requestId = 0;
  let panorama = null;
  let animationFrame = 0;
  let autoplayTimer = null;
  let toastTimer = null;
  let relatedFilter = null;
  let motion = !reducedMotion && !coarsePointer;
  let fit = false;
  let uiHidden = false;
  let rect = viewport.getBoundingClientRect();
  let target = {x: 0, y: 0, zoom: 1.06};
  let position = {...target};
  let pinch = null;
  let edgeFrame = 0, edgeTime = 0;
  let velocity = {x:0,y:0};
  let sourceIndex = 0;
  let showEnhancedReference = false;
  function stopEdgeMotion() { cancelAnimationFrame(edgeFrame); edgeFrame=0; edgeTime=0; velocity={x:0,y:0}; }
  function edgeMotion(time) {
    if(!motion || !panorama || document.querySelector('dialog[open]')) {stopEdgeMotion();return;}
    const dt=edgeTime?Math.min((time-edgeTime)/1000,.05):0; edgeTime=time;
    panorama.setYaw(panorama.getYaw()+velocity.x*dt,false);
    panorama.setPitch(clamp(panorama.getPitch()+velocity.y*dt,-80,80),false);
    edgeFrame=requestAnimationFrame(edgeMotion);
  }
  const pointers = new Map();

  function svg(name) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-'+name);
    icon.append(use);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  function announce(message) { $('live-status').textContent = message; }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
  }
  function visibleScenes() {
    return tour.scenes.filter(scene => activeCategory === 'all' || scene.category === activeCategory);
  }
  function currentGroup() { return tour.scenes.filter(scene => scene.group === current.group); }
  function bounds(zoom = target.zoom) {
    const base = (fit ? Math.min : Math.max)(rect.width/current.width, rect.height/current.height);
    return {width: current.width*base*zoom, height: current.height*base*zoom,
      x: Math.max(0, (current.width*base*zoom-rect.width)/2),
      y: Math.max(0, (current.height*base*zoom-rect.height)/2)};
  }
  function scheduleRender() {
    if (!animationFrame) animationFrame = requestAnimationFrame(renderPosition);
  }
  function renderPosition() {
    animationFrame = 0;
    if (current.type !== 'flat') return;
    const targetBounds = bounds();
    target.x = clamp(target.x, -targetBounds.x, targetBounds.x);
    target.y = clamp(target.y, -targetBounds.y, targetBounds.y);
    const easing = reducedMotion || pointers.size ? 1 : .16;
    for (const key of ['x','y','zoom']) position[key] += (target[key]-position[key])*easing;
    const size = bounds(position.zoom);
    position.x = clamp(position.x, -size.x, size.x);
    position.y = clamp(position.y, -size.y, size.y);
    photo.style.width = size.width+'px';
    photo.style.height = size.height+'px';
    photo.style.transform = `translate3d(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px), 0)`;
    if (Math.abs(target.x-position.x)>.05 || Math.abs(target.y-position.y)>.05 || Math.abs(target.zoom-position.zoom)>.001) scheduleRender();
  }
  function resize() {
    rect = viewport.getBoundingClientRect();
    if (panorama) panorama.resize();
    else scheduleRender();
  }
  new ResizeObserver(resize).observe(viewport);
  function syncMotionButton() {
    $('motion').setAttribute('aria-pressed', String(motion));
    $('motion').setAttribute('aria-label', `Turn pointer motion ${motion?'off':'on'}`);
    $('motion').title = `Pointer motion ${motion?'on':'off'}`;
  }
  function setMotion(value) {
    motion=value; syncMotionButton(); stopEdgeMotion();
    if(panorama) {if(value) panorama.startAutoRotate(-.7);else panorama.stopAutoRotate();}
  }
  function initialPanoramaHfov() {
    const mobile = rect.width < 620;
    return clamp(Number(current.initialHfov?.[mobile ? 'mobile' : 'desktop']) || (mobile ? 75 : 100), minPanoramaHfov(), 120);
  }
  // Narrowest field of view before the panorama is stretched past twice its own pixel density,
  // which is where it visibly turns soft and blocky.
  function minPanoramaHfov() {
    const screenPixels = rect.width * (window.devicePixelRatio || 1);
    const panoramaPixelsPerDegree = (current.width || 3840) / 360;
    return clamp(Math.round(screenPixels / (panoramaPixelsPerDegree * 2)), 50, 100);
  }
  function resetView() {
    if (panorama) { panorama.lookAt(current.pitch || 0, current.yaw || 0, initialPanoramaHfov(), reducedMotion?false:350); return; }
    fit = current.initialFit === 'contain';
    target = {x:0, y:0, zoom:fit?1:1.06};
    position = {...target};
    updateFitButton();
    scheduleRender();
  }
  function updateFitButton() {
    $('fit').disabled = current.type !== 'flat';
    $('fit').setAttribute('aria-label', fit ? 'Fill screen with image' : 'Show full image');
    $('fit').title = fit ? 'Fill screen with image' : 'Show full image';
  }
  function zoomBy(factor, origin) {
    pauseAutoplay();
    if (panorama) { panorama.setHfov(clamp(panorama.getHfov()/factor,minPanoramaHfov(),120), reducedMotion?false:150); return; }
    const next = clamp(target.zoom*factor, 1, 4);
    const ratio = next/target.zoom;
    if (origin) {
      const x=origin.x-rect.left-rect.width/2, y=origin.y-rect.top-rect.height/2;
      target.x=x-(x-target.x)*ratio;
      target.y=y-(y-target.y)*ratio;
    } else { target.x*=ratio; target.y*=ratio; }
    target.zoom=next;
    scheduleRender();
  }
  function readUrlScene() {
    const query = new URLSearchParams(location.hash.slice(1));
    return query.get('view') || new URLSearchParams(location.search).get('scene');
  }
  function writeUrlScene(mode) {
    const url = new URL(location.href);
    url.hash = 'view='+current.id;
    if (url.href === location.href) return;
    try { history[mode === 'push' ? 'pushState' : 'replaceState']({view:current.id}, '', url); }
    catch { location.hash = url.hash; }
  }
  function updateSelection() {
    for (const button of all('.thumb')) button.setAttribute('aria-current', String(button.dataset.scene === current.id));
    const selected = document.querySelector(`.thumb[data-scene="${current.id}"]`);
    if (selected) selected.scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'nearest',inline:'nearest'});
    const visible = visibleScenes();
    const index = visible.findIndex(scene => scene.id === current.id);
    $('scene-counter').replaceChildren(document.createTextNode(String(index+1).padStart(2,'0')+' '));
    const total = document.createElement('span'); total.textContent='/ '+String(visible.length).padStart(2,'0');
    $('scene-counter').append(total);
    $('scene-category').textContent = current.categoryTitle;
    $('scene-title').textContent = current.title;
    $('scene-subtitle').textContent = current.subtitle;
    $('view-kind').textContent = current.type === 'equirectangular' ? (current.enhancement?'4K · ':'')+'CONCEPT 360° · ARTIST’S IMPRESSION' : "ARCHITECT'S PERSPECTIVE";
    $('gesture-hint').textContent = coarsePointer ? 'Swipe to look around · tap a marker to change space' : 'Drag to look around · click a marker to explore the next space';
    const group = currentGroup();
    $('related').hidden = !current.references?.length;
    $('angle-count').textContent = 'Architect’s references';
    const destination=sceneById.get(current.next);
    $('continue-label').textContent=destination?.title || 'Next space';
    $('continue').setAttribute('aria-label','Continue to '+(destination?.title || 'next space'));
    $('previous').disabled = $('next').disabled = visible.length < 2;
    $('autoplay').disabled = visible.length < 2;
    document.title = `${current.title} — Aureum Mall & Residences`;
    viewport.dataset.scene = current.id;
    viewport.dataset.renderMode = current.type;
    updateInfo();
  }
  function preloadImage(url) {
    return new Promise((resolve,reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image unavailable'));
      image.src = url;
    });
  }
  async function openScene(id, {manual=true, historyMode='push'}={}) {
    const next = sceneById.get(id);
    if (!next) return;
    if (manual) pauseAutoplay();
    current = next;
    const token = ++requestId;
    pointers.clear(); pinch=null;
    stopEdgeMotion();
    viewport.classList.remove('is-dragging');
    if (panorama) { panorama.destroy(); panorama=null; }
    $('panorama').hidden=true;
    photo.hidden=false;
    photo.classList.remove('loaded');
    $('loading').hidden=false;
    $('load-error').hidden=true;
    viewport.setAttribute('aria-busy','true');
    if (!visibleScenes().some(scene => scene.id===id)) {
      activeCategory='all'; renderCategories(); renderThumbnails();
    }
    updateSelection();
    if (historyMode) writeUrlScene(historyMode);
    try {
      const image=await preloadImage(current.image);
      if (token!==requestId) return;
      if (current.type==='equirectangular') {
        if (image.naturalWidth !== image.naturalHeight*2) throw new Error('A full 2:1 panorama is required');
        photo.hidden=true;
        $('panorama').hidden=false;
        const hotspots=(current.hotspots||[]).filter(h=>(h.verified===true || (tour.isConceptTour && h.connectionType==='concept')) && sceneById.has(h.target)).map(h=>({pitch:h.pitch,yaw:h.yaw,cssClass:'aureum-hotspot',createTooltipFunc:element=>{
          const button=document.createElement('button');button.className='portal';button.dataset.target=h.target;
          button.setAttribute('aria-label','Explore '+sceneById.get(h.target).title);
          const ring=document.createElement('span');ring.className='portal-ring';ring.append(svg('right'));
          const label=document.createElement('span');label.className='portal-label';label.textContent=h.label;
          button.append(ring,label);button.addEventListener('click',event=>{event.stopPropagation();openScene(h.target);});
          button.addEventListener('pointerdown',event=>event.stopPropagation());element.append(button);
        }}));
        panorama=window.pannellum.viewer('panorama',{type:'equirectangular',panorama:current.image,autoLoad:true,showControls:false,escapeHTML:true,mouseZoom:true,keyboardZoom:false,disableKeyboardCtrl:true,hfov:initialPanoramaHfov(),minHfov:minPanoramaHfov(),maxHfov:120,yaw:current.yaw||0,pitch:current.pitch||0,autoRotate:motion?-.7:0,hotSpots:hotspots});
        panorama.on('load',()=>{if(token===requestId) finishLoading();});
        panorama.on('error',()=>{if(token===requestId) showLoadError();});
      } else {
        if (image.naturalWidth!==current.width || image.naturalHeight!==current.height) {
          current.width=image.naturalWidth; current.height=image.naturalHeight;
        }
        photo.src=current.image;
        photo.alt=`${current.title}. ${current.subtitle}`;
        $('backdrop').style.backgroundImage=`url("${current.image}")`;
        resetView();
        photo.classList.add('loaded');
        finishLoading();
      }
      updateFitButton();
      const list=visibleScenes();
      const upcoming=list[(list.findIndex(s=>s.id===current.id)+1)%list.length];
      if(upcoming && upcoming.id!==current.id) { const cached=new Image(); cached.src=upcoming.image; }
    } catch { if(token===requestId) showLoadError(); }
  }
  function finishLoading() {
    $('loading').hidden=true;
    viewport.setAttribute('aria-busy','false');
    announce(`${current.title}. ${current.subtitle}. View ${visibleScenes().findIndex(s=>s.id===current.id)+1} of ${visibleScenes().length}.`);
  }
  function showLoadError() {
    $('loading').hidden=true;
    $('load-error').hidden=false;
    viewport.setAttribute('aria-busy','false');
    pauseAutoplay();
    announce('This image could not be loaded. Choose Try again or another view.');
  }
  function step(direction,manual=true) {
    const list=visibleScenes();
    const index=list.findIndex(scene=>scene.id===current.id);
    openScene(list[(index+direction+list.length)%list.length].id,{manual,historyMode:manual?'push':'replace'});
  }
  function renderCategories() {
    const nav=$('category-nav'); nav.replaceChildren();
    for (const category of [{id:'all',title:'Full tour',count:tour.scenes.length},...tour.categories]) {
      const button=document.createElement('button');
      button.className='category-button';
      button.setAttribute('aria-pressed',String(category.id===activeCategory));
      button.dataset.category=category.id;
      button.append(document.createTextNode(category.title));
      const count=document.createElement('small'); count.textContent=category.count; button.append(count);
      button.addEventListener('click',()=>{
        pauseAutoplay(); activeCategory=category.id;
        renderCategories(); renderThumbnails();
        if(!visibleScenes().some(scene=>scene.id===current.id)) openScene(visibleScenes()[0].id);
        else updateSelection();
      });
      nav.append(button);
    }
  }
  function renderThumbnails() {
    const container=$('thumbnails'); container.replaceChildren();
    visibleScenes().forEach((scene,index)=>{
      const item=document.createElement('div'); item.setAttribute('role','listitem');
      const button=document.createElement('button'); button.className='thumb'; button.dataset.scene=scene.id;
      button.setAttribute('aria-label',`View ${index+1}: ${scene.title}. ${scene.subtitle}`);
      button.title=`${scene.title} — ${scene.subtitle}`;
      const image=document.createElement('img'); image.src=scene.thumbnail; image.alt=''; image.loading='lazy';
      const text=document.createElement('span'); text.textContent=scene.title;
      button.append(image,text); button.addEventListener('click',()=>openScene(scene.id));
      item.append(button); container.append(item);
    });
  }
  function openDialog(id) {
    pauseAutoplay();
    if(panorama) panorama.stopAutoRotate();stopEdgeMotion();
    all('dialog[open]').forEach(dialog=>dialog.close());
    $(id).showModal();
  }
  function renderSpaces() {
    const words=$('space-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const results=$('space-results'); results.replaceChildren();
    const matches=tour.scenes.filter(scene=>{
      const haystack=`${scene.title} ${scene.subtitle} ${scene.categoryTitle} ${scene.originalFilename} ${scene.id}`.toLowerCase();
      return (!relatedFilter || scene.group===relatedFilter) && words.every(word=>haystack.includes(word));
    });
    for(const category of tour.categories) {
      const scenes=matches.filter(scene=>scene.category===category.id);
      if(!scenes.length) continue;
      const section=document.createElement('section'); section.className='space-group';
      const heading=document.createElement('h3'); heading.textContent=category.title; section.append(heading);
      scenes.forEach(scene=>{
        const button=document.createElement('button'); button.className='space-item';
        button.setAttribute('aria-current',String(scene.id===current.id)); button.dataset.scene=scene.id;
        const image=document.createElement('img'); image.src=scene.thumbnail; image.alt=''; image.loading='lazy';
        const text=document.createElement('div'); const title=document.createElement('strong'); title.textContent=scene.title;
        const subtitle=document.createElement('small'); subtitle.textContent=scene.subtitle; text.append(title,subtitle);
        button.append(image,text,svg('right'));
        button.addEventListener('click',()=>{$('spaces-dialog').close(); openScene(scene.id);});
        section.append(button);
      }); results.append(section);
    }
    if(!matches.length) { const empty=document.createElement('p'); empty.className='dialog-footnote'; empty.textContent='No views found. Try a space name, Design A, Design B or an image ID.'; results.append(empty); }
  }
  function showSpaces(group=null) {
    relatedFilter=group; $('space-search').value='';
    $('spaces-dialog').querySelector('h2').textContent=group?'More perspectives.':'Explore the spaces.';
    renderSpaces(); openDialog('spaces-dialog');
  }
  function updateInfo() {
    $('info-title').textContent=current.title;
    $('info-subtitle').textContent=current.subtitle;
    $('info-description').textContent=current.description;
    $('info-note').textContent=current.note;
    const data=[['Source references',current.sourceId],['Panorama',`${current.width} × ${current.height} px`],['Format','360° concept visualization'],['Connections','Illustrative tour sequence · physical adjacency unverified']];
    if(current.enhancement)data.push(['Resolution','4K upscale · original framing retained']);
    if(current.design) data.push(['Design set',`${current.design} · unit type unassigned`]);
    const list=$('info-details'); list.replaceChildren();
    data.forEach(([label,value])=>{const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;list.append(dt,dd);});
    const related=$('info-related'); related.replaceChildren();
    currentGroup().forEach((scene,index)=>{
      if(scene.id===current.id) return;
      const button=document.createElement('button');button.className='pill-button';button.textContent='View angle '+(index+1);button.title=scene.subtitle;
      button.addEventListener('click',()=>{$('info-dialog').close();openScene(scene.id);});related.append(button);
    });
  }
  function pauseAutoplay() {
    clearInterval(autoplayTimer); autoplayTimer=null;
    $('autoplay').setAttribute('aria-pressed','false');
    $('autoplay').querySelector('use').setAttribute('href','#i-play');
    $('autoplay').querySelector('span').textContent='Play tour';
  }
  function toggleAutoplay() {
    if(autoplayTimer) {pauseAutoplay();return;}
    $('autoplay').setAttribute('aria-pressed','true');
    $('autoplay').querySelector('use').setAttribute('href','#i-pause');
    $('autoplay').querySelector('span').textContent='Pause tour';
    setMotion(true);
    autoplayTimer=setInterval(()=>{if(!document.hidden && viewport.getAttribute('aria-busy')!=='true') step(1,false);},16000);
  }
  function toggleUI() {
    uiHidden=!uiHidden;
    $('viewer').classList.toggle('ui-hidden',uiHidden);
    all('.chrome').forEach(element=>{element.inert=uiHidden;});
    $('show-ui').hidden=!uiHidden;
    if(uiHidden) $('show-ui').focus(); else viewport.focus({preventScroll:true});
    requestAnimationFrame(resize);
  }
  async function fullscreen() {
    try {if(document.fullscreenElement) await document.exitFullscreen(); else await $('viewer').requestFullscreen();}
    catch {toast('Fullscreen is not available in this browser view.');}
  }
  $('previous').addEventListener('click',()=>step(-1));
  $('next').addEventListener('click',()=>step(1));
  $('continue').addEventListener('click',()=>openScene(current.next));
  $('home').addEventListener('click',()=>{activeCategory='all';renderCategories();renderThumbnails();openScene(tour.defaultScene);});
  $('zoom-in').addEventListener('click',()=>zoomBy(1.2));
  $('zoom-out').addEventListener('click',()=>zoomBy(1/1.2));
  $('reset').addEventListener('click',()=>{pauseAutoplay();resetView();});
  $('fit').addEventListener('click',()=>{pauseAutoplay();fit=!fit;target={x:0,y:0,zoom:fit?1:1.06};position={...target};updateFitButton();scheduleRender();announce(fit?'Full image shown.':'Image fills the screen.');});
  $('motion').addEventListener('click',()=>{setMotion(!motion);toast(motion?'Pointer motion on. Move across the image.':'Pointer motion off. Drag to explore.');});
  $('open-spaces').addEventListener('click',()=>showSpaces());
  function renderSource() {
    const source=current.references[sourceIndex];
    const enhanced=showEnhancedReference && !!source.enhancedImage;
    $('reference-image').src=enhanced?source.enhancedImage:source.image;$('reference-image').alt=source.title;
    $('reference-caption').textContent=source.title+' · '+source.id+(enhanced?' · '+source.enhancedWidth+' × '+source.enhancedHeight+' px':' · Original');
    $('reference-versions').hidden=!source.enhancedImage;
    $('source-enhanced').setAttribute('aria-pressed',String(enhanced));
    $('source-original').setAttribute('aria-pressed',String(!enhanced));
    $('reference-provenance').textContent=enhanced?'4K copy of the supplied architect’s reference. Framing and proportions are retained. Choose Original to compare.':'Original supplied image. Compare this with the concept panorama; its surroundings are an interpretation of these references.';
    $('reference-count').textContent=(sourceIndex+1)+' / '+current.references.length;
    $('source-previous').disabled=$('source-next').disabled=current.references.length<2;
  }
  $('related').addEventListener('click',()=>{sourceIndex=0;showEnhancedReference=false;renderSource();openDialog('references-dialog');});
  $('source-enhanced').addEventListener('click',()=>{showEnhancedReference=true;renderSource();});
  $('source-original').addEventListener('click',()=>{showEnhancedReference=false;renderSource();});
  $('source-previous').addEventListener('click',()=>{sourceIndex=(sourceIndex-1+current.references.length)%current.references.length;renderSource();});
  $('source-next').addEventListener('click',()=>{sourceIndex=(sourceIndex+1)%current.references.length;renderSource();});
  $('open-info').addEventListener('click',()=>{updateInfo();openDialog('info-dialog');});
  $('space-search').addEventListener('input',()=>{relatedFilter=null;renderSpaces();});
  $('autoplay').addEventListener('click',toggleAutoplay);
  $('hide-ui').addEventListener('click',toggleUI);$('show-ui').addEventListener('click',toggleUI);
  $('fullscreen').addEventListener('click',fullscreen);
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');resize();});
  $('retry').addEventListener('click',()=>openScene(current.id,{historyMode:null}));
  all('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  all('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}}));
  $('share').addEventListener('click',()=>{
    const url=new URL(location.href);url.hash='view='+current.id;
    $('share-link').value=url.href;
    $('share-note').textContent=location.protocol==='file:'?'This is a local file link. After hosting the dist folder, this control shares its public URL.':/^localhost$|^127\.0\.0\.1$/.test(location.hostname)?'This preview link opens on this computer. After hosting, it shares the same selected view on your live domain.':'This link opens the selected architectural view.';
    openDialog('share-dialog');
  });
  $('copy-link').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('share-link').value);toast('View link copied.');$('share-dialog').close();}
    catch{$('share-link').focus();$('share-link').select();toast('Link selected. Use your browser’s Copy command.');}
  });
  viewport.addEventListener('wheel',event=>{
    if(panorama) return;
    event.preventDefault();zoomBy(Math.exp(-event.deltaY*.0012),{x:event.clientX,y:event.clientY});
  },{passive:false});
  viewport.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    pauseAutoplay();setMotion(false);
    if(panorama) return;
    viewport.focus({preventScroll:true});
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
    if(pointers.size===2){const[a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:target.zoom};}
  });
  viewport.addEventListener('pointermove',event=>{
    if(pointers.has(event.pointerId)) {
      const before=pointers.get(event.pointerId);
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()];target.zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),1,4);}
      else if(pointers.size===1){target.x+=event.clientX-before.x;target.y+=event.clientY-before.y;}
      scheduleRender();return;
    }
    if(!motion||event.pointerType==='touch')return;
    const x=clamp((event.clientX-rect.left)/rect.width*2-1,-1,1);
    const y=clamp((event.clientY-rect.top)/rect.height*2-1,-1,1);
    if(panorama){
      panorama.stopAutoRotate();velocity={x:Math.abs(x)>.2?x*16:0,y:Math.abs(y)>.35?-y*7:0};
      if(!edgeFrame) edgeFrame=requestAnimationFrame(edgeMotion);
    }
    else{const limit=bounds();target.x=-x*limit.x*.8;target.y=-y*limit.y*.8;scheduleRender();}
  });
  function pointerEnd(event){pointers.delete(event.pointerId);pinch=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(!pointers.size)viewport.classList.remove('is-dragging');}
  viewport.addEventListener('pointerup',pointerEnd);viewport.addEventListener('pointercancel',pointerEnd);
  viewport.addEventListener('pointerleave',()=>{stopEdgeMotion();if(motion&&panorama&&!document.querySelector('dialog[open]'))panorama.startAutoRotate(-.7);if(!pointers.size&&motion&&!panorama){target.x=0;target.y=0;scheduleRender();}});
  viewport.addEventListener('dblclick',()=>zoomBy(1.35));
  document.addEventListener('keydown',event=>{
    if(event.target.closest('input,textarea,select')||document.querySelector('dialog[open]'))return;
    const key=event.key.toLowerCase();
    if(['arrowright','arrowleft','arrowup','arrowdown'].includes(key)&&panorama){
      event.preventDefault();pauseAutoplay();setMotion(false);
      if(key==='arrowright'||key==='arrowleft')panorama.setYaw(panorama.getYaw()+(key==='arrowright'?18:-18),180);
      else panorama.setPitch(clamp(panorama.getPitch()+(key==='arrowup'?12:-12),-85,85),180);
    }
    else if(key==='pagedown'){event.preventDefault();step(1);}
    else if(key==='pageup'){event.preventDefault();step(-1);}
    else if(key==='+'||key==='='){event.preventDefault();zoomBy(1.2);}
    else if(key==='-'){event.preventDefault();zoomBy(1/1.2);}
    else if(key==='0'){resetView();}
    else if(key==='f'){fullscreen();}
    else if(key==='h'){toggleUI();}
    else if(key==='/'&&!event.target.closest('button')){event.preventDefault();showSpaces();}
    else if(key===' '&&!event.target.closest('button')){event.preventDefault();toggleAutoplay();}
  });
  function handleHistory(){const id=readUrlScene();if(sceneById.has(id)&&id!==current.id)openScene(id,{historyMode:null});}
  window.addEventListener('popstate',handleHistory);window.addEventListener('hashchange',handleHistory);
  renderCategories();renderThumbnails();syncMotionButton();
  const linked=readUrlScene();
  openScene(sceneById.has(linked)?linked:tour.defaultScene,{manual:false,historyMode:'replace'});
})();
