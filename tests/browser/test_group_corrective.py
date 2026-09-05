"""Actual Group template/scripts, deterministic API + media boundaries.

These checks are browser integration, not physical-device/LiveKit cloud proof.
Run once after source freeze: BROWSER_QA_ENABLED=1 pytest this-file.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest
from jinja2 import Environment

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Explicit final browser QA gate", allow_module_level=True)
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "app/static/group-v3"

DEVICE = """
window.__mediaCounts={acquire:0,publish:0,rooms:0,attach:0};
window.__makeStream=()=> {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const c=canvas.getContext('2d');c.fillStyle='#186f62';c.fillRect(0,0,640,360);
  c.fillStyle='white';c.font='40px sans-serif';c.fillText('QA video source',80,180);
  const stream=canvas.captureStream(10);
  const paint=setInterval(()=>{c.fillStyle='#186f62';c.fillRect(0,0,640,360);c.fillStyle='white';c.fillText('QA video source',80,180);},100);
  stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(paint));
  const audio=new AudioContext(), oscillator=audio.createOscillator(), dest=audio.createMediaStreamDestination();
  oscillator.connect(dest);oscillator.start();stream.addTrack(dest.stream.getAudioTracks()[0]);
  return stream;
};
window.GroupV3DeviceManager={
 enumerate:async()=>({audioInputs:[],videoInputs:[],audioOutputs:[]}),remembered:()=>'',remember:()=>{},
 acquire:async()=>{__mediaCounts.acquire++;return window.__local=__makeStream();},
 startMeter:()=>()=>{},stop:()=>{if(window.__local)__local.getTracks().forEach(t=>t.stop());},
 setOutput:async()=>{},normalizeError:e=>({code:e.code||'device_error'}),onDeviceChange:()=>()=>{}
};
window.EventSource=class {addEventListener(){}close(){}};
window.LivekitClient={
 RoomEvent:{TrackSubscribed:'sub',TrackUnsubscribed:'unsub',Disconnected:'disconnected',ActiveSpeakersChanged:'speakers'},
 Track:{Source:{Camera:'camera',Microphone:'microphone'}},
 Room:class {
  constructor(){__mediaCounts.rooms++;this.events={};this.remoteParticipants=new Map();
    this.localParticipant={publishTrack:async()=>{__mediaCounts.publish++;}};}
  on(k,f){this.events[k]=f;return this;}
  async connect(){const stream=__makeStream();const track={
    kind:'video',sid:'remote-video-1',mediaStreamTrack:stream.getVideoTracks()[0],
    attach(){__mediaCounts.attach++;const v=document.createElement('video');v.srcObject=stream;v.muted=true;this.el=v;return v;},
    detach(){return this.el?[this.el]:[];}
   };this.remoteParticipants.set('guest',{identity:'guest',trackPublications:new Map([['v',{track}]])});
   this.events.sub?.(track,{}, {identity:'guest'});}
  removeAllListeners(){this.events={};}disconnect(){}
 }
};
"""


@pytest.fixture
def page(chromium_browser):
    context = chromium_browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    yield page
    assert not errors, errors
    context.close()


def boot(page, surface="video", connected=True):
    members = [dict(id="m1", principal_type="member", principal_id="42", principal_user_id="42",
        display_name="Nguyễn Minh", role="owner", status="active"),
        dict(id="m2", principal_type="member", principal_id="84", principal_user_id="84",
        display_name="Trần An", role="member", status="active")]
    people = [dict(id="p1", membership_id="m1", livekit_identity="owner", display_name="Nguyễn Minh", invite_status="joined", media_connected=True),
        dict(id="p2", membership_id="m2", livekit_identity="guest", display_name="Trần An", invite_status="joined", media_connected=True)]
    session = dict(id="r1", media_kind="video", title="QA Video", status="active", participants=people)
    profile = dict(spoken_language="vi", preferred_output_language="zh-TW", auto_translate_enabled=False, auto_read_enabled=False)
    template = (ROOT / "app/templates/group_communication_v3.html").read_text(encoding="utf-8")
    # The external media SDK is the only replaced script. All Group scripts/CSS
    # and their production load order are unchanged.
    import re
    template = re.sub(r'<script src="https://cdn.jsdelivr.net[^<]+</script>', "", template)
    html = Environment().from_string(template).render(locale="vi", runtime_config={"locale":"vi", "initial_surface":surface})
    def handle(route):
        path = urlparse(route.request.url).path
        if path.startswith("/static/"):
            if path.endswith("/group_device_manager.js"):
                return route.fulfill(content_type="application/javascript", body=DEVICE)
            file = ROOT / "app" / path.lstrip("/")
            if file.exists():
                return route.fulfill(path=str(file))
            return route.fulfill(status=204)
        if path.startswith("/group/"):
            return route.fulfill(content_type="text/html", body=html)
        payload = {}
        if path == "/api/group/session":
            payload = dict(principal=dict(type="member", id="42", user_id="42", locale="vi"), group_authorized=True, direct_available=False)
        elif path == "/api/group/spaces":
            payload = {"spaces":[dict(id="s1",title="Điều phối QA",status="active",version=1)]}
        elif path.endswith("/memberships"): payload={"memberships":members}
        elif path.endswith("/translation/profile"):
            if route.request.method == "PUT": profile.update(route.request.post_data_json)
            payload={"profile":profile}
        elif path.endswith("/translation/consent"): payload={"consent":{"status":"granted"}}
        elif path.endswith("/sessions"): payload={"sessions":[session]}
        elif path.endswith("/radio/sessions/r1"): payload={"session":session,"floor":None}
        elif path.endswith("/radio/sessions/r1/join"): payload={"session":session}
        elif path.endswith("/connection-state"): payload={"session":session}
        elif path.endswith("/media-grant"):
            payload={"grant":{"provider":"livekit-cloud","url":"wss://fixture.invalid","token":"fixture-only","participant_identity":"owner","media_kind":"video"}}
        route.fulfill(content_type="application/json", body=json.dumps(payload))
    page.route("**/*", handle)
    page.goto("http://127.0.0.1:8765/group/" + surface)
    expect(page.locator(".native-app")).to_be_visible()
    if connected:
        page.locator('.call-control-dock [data-action="connect-media"]').click()
        page.locator('[data-action="prepare-prejoin"]').click()
        page.locator('[data-action="confirm-prejoin"]').click()
        page.wait_for_function("GroupV3Runtime.snapshot().media_connected")
        expect(page.locator(".local-media")).to_have_count(1)
        expect(page.locator(".remote-media")).to_have_count(1)
        page.wait_for_function("document.querySelector('.remote-media').videoWidth > 0")


def geometry(page):
    return page.evaluate("""() => Object.fromEntries(
      ['.native-mobile','.native-main','.surface-content','.video-call-layout','.video-stage','.video-grid',
       '.call-control-dock','.translation-dock','.translation-dock__bar','.translation-dock__body','.translation-safety-layer']
      .map(s=>{let n=document.querySelector(s);if(!n)return [s,null];let r=n.getBoundingClientRect(),c=getComputedStyle(n);
      return [s,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,rows:c.gridTemplateRows,
        columns:c.gridTemplateColumns,padding:c.padding,minHeight:c.minHeight,display:c.display}]}))""")


@pytest.mark.parametrize("width,height", [(390,844),(844,390),(412,915)])
def test_mobile_geometry_and_panel_modes(page, tmp_path, width, height):
    page.set_viewport_size({"width":width,"height":height})
    boot(page)
    g = geometry(page)
    assert g[".native-main"]["y"] == 0, g
    assert g[".surface-content"]["height"] == height, g
    assert g[".translation-dock"]["height"] <= 64, g
    assert g[".translation-dock"]["bottom"] == height, g
    assert g[".translation-safety-layer"]["display"] == "none", g
    buttons = page.locator(".call-control-dock > .action-button")
    boxes = [buttons.nth(i).bounding_box() for i in range(4)]
    assert len({round(b["y"]) for b in boxes}) == 1, boxes
    assert all(b["width"] >= 44 and b["height"] >= 44 for b in boxes)
    page.screenshot(path=str(tmp_path / f"{width}x{height}-collapsed.png"))
    counts = page.evaluate("({...__mediaCounts})")
    for mode in ["HALF", "FULL"]:
        page.locator('[data-workspace-action="translation-plus"]').click()
        expect(page.locator(".translation-dock")).to_have_attribute("data-translation-mode", mode)
        expect(page.locator("[data-v2-text]")).to_be_visible()
        assert page.locator(".translation-dock").bounding_box()["y"] >= 0
        page.screenshot(path=str(tmp_path / f"{width}x{height}-{mode}.png"))
    page.locator('[data-workspace-action="translation-minus"]').click()
    page.locator('[data-workspace-action="translation-minus"]').click()
    assert page.evaluate("({...__mediaCounts})") == counts
    (tmp_path / "geometry.json").write_text(json.dumps(g, indent=2), encoding="utf-8")


def test_desktop_arbitration_and_stable_media_panel_dom(page, tmp_path):
    page.set_viewport_size({"width":1440,"height":900})
    boot(page)
    page.evaluate("window.__savedPanel=document.querySelector('[data-group-translation-v2]');window.__savedVideo=document.querySelector('.remote-media')")
    page.locator('[data-workspace-action="video-plus"]').click()
    page.locator('[data-workspace-action="translation-plus"]').click()
    expect(page.locator(".video-call-layout")).to_have_attribute("data-video-mode","STANDARD")
    expect(page.locator(".translation-dock")).to_have_attribute("data-translation-mode","HALF")
    page.wait_for_function("document.querySelector('.translation-dock').getBoundingClientRect().width >= 320")
    page.locator('[data-workspace-action="translation-plus"]').click()
    expect(page.locator(".translation-dock")).to_have_attribute("data-translation-mode","FULL")
    page.locator('[data-workspace-action="translation-minus"]').click()
    page.locator('[data-workspace-action="translation-minus"]').click()
    expect(page.locator(".video-call-layout")).to_have_attribute("data-video-mode","MAXIMIZED")
    page.locator('[data-action="refresh"]').click()
    page.wait_for_function("document.querySelector('#group-native-app').getAttribute('aria-busy') === null")
    assert page.evaluate("__savedPanel===document.querySelector('[data-group-translation-v2]') && __savedVideo===document.querySelector('.remote-media')")
    assert page.evaluate("__mediaCounts.attach") == 1
    page.screenshot(path=str(tmp_path / "desktop-max-closed.png"), animations="disabled")
    page.locator('[data-workspace-action="translation-plus"]').click()
    page.wait_for_function("document.querySelector('.translation-dock').getBoundingClientRect().width >= 320")
    expect(page.locator(".video-compact-summary")).to_be_hidden()
    page.screenshot(path=str(tmp_path / "desktop-standard-open.png"), animations="disabled")


RECORDER = """
window.__recorderOptions=[];window.__recorders=0;
window.MediaRecorder=class extends EventTarget {
 static isTypeSupported(mime){return mime===window.__testMime;}
 constructor(stream,options){super();this.state='inactive';this.mimeType=options?.mimeType||__testMime;
   __recorderOptions.push(options);this.stream=stream;__recorders++;}
 start(){this.state='recording';}
 stop(){this.state='inactive';queueMicrotask(()=>{
   if(window.__emptyAudio!==true)this.dispatchEvent(new MessageEvent('dataavailable',{data:new Blob(['fixture audio'],{type:this.mimeType})}));
   this.dispatchEvent(new Event('stop'));
 });}
};
"""


def voice_setup(page, mime="audio/mp4"):
    boot(page)
    page.evaluate("(mime)=>window.__testMime=mime", mime)
    page.evaluate("() => {" + RECORDER + "}")
    page.locator('[data-workspace-action="translation-plus"]').click()
    return page.locator('[data-v2-action="record"]')


@pytest.mark.parametrize("mime,extension", [("audio/mp4","m4a"),("audio/webm;codecs=opus","webm"),("audio/ogg;codecs=opus","ogg")])
def test_voice_save_mime_and_history_failure_keeps_result(page, mime, extension):
    button = voice_setup(page, mime)
    uploads = []
    result = {"id":"seg1","source_language":"vi","source_text":"Canonical fixture","state":"FINAL","author_view":True,"variants":[]}
    def upload(route):
        uploads.append(route.request.post_data_buffer)
        route.fulfill(content_type="application/json",body=json.dumps({"segment":result}))
    page.route("**/translation/segments/voice", upload)
    page.route("**/translation/v2-history?*", lambda r:r.fulfill(status=503,content_type="application/json",body='{"detail":"history_unavailable"}'))
    button.click()
    expect(button).to_have_attribute("data-voice-icon","save")
    expect(button).to_have_attribute("aria-pressed","true")
    # A normal shell refresh must not dispose a recording.
    page.evaluate("document.querySelector('[data-action=refresh]').click()")
    page.wait_for_function("!document.querySelector('#group-native-app').hasAttribute('aria-busy')")
    expect(button).to_have_attribute("data-voice-icon","save")
    button.click()
    expect(page.locator("[data-segment-id=seg1]")).to_be_visible()
    expect(button).to_have_attribute("data-voice-icon","mic")
    expect(page.locator("[data-v2-warning]")).to_be_visible()
    expect(page.locator("[data-v2-error]")).to_be_hidden()
    assert len(uploads) == 1 and f'group-translation.{extension}'.encode() in uploads[0]
    assert b'duration_seconds' in uploads[0] and mime.encode() in uploads[0]
    assert page.evaluate("GroupV3Runtime.getLocalAudioTrack().readyState") == "live"
    assert page.evaluate("__mediaCounts.acquire") == 1
    assert not any("Canonical fixture" in json.dumps(row) for row in page.evaluate("GroupV3TranslationController.diagnostics()"))


def test_empty_audio_and_muted_mic_are_visible_errors(page):
    button = voice_setup(page)
    page.evaluate("window.__emptyAudio=true")
    button.click()
    expect(button).to_have_attribute("data-voice-icon","save")
    button.click()
    expect(page.locator("[data-v2-error]")).to_have_attribute("data-error-category","EMPTY_AUDIO_ERROR")
    page.evaluate("GroupV3Runtime.getLocalAudioTrack().enabled=false")
    button.click()
    expect(page.locator("[data-v2-error]")).to_have_attribute("data-error-category","RECORDING_ERROR")
    assert page.evaluate("__recorders") == 1


def test_exact_remote_identity_waits_until_tile_exists(page):
    boot(page)
    page.evaluate("""() => {
      const stream=__makeStream();
      window.__lateTrack={kind:'video',sid:'late',mediaStreamTrack:stream.getVideoTracks()[0],
        attach(){__mediaCounts.attach++;const node=document.createElement('video');node.muted=true;node.srcObject=stream;return node;},detach(){return []}};
      GroupMediaPresentation.remote(__lateTrack,'late-person');
    }""")
    assert page.evaluate("__mediaCounts.attach") == 1
    page.evaluate("""() => {
      const tile=document.createElement('article');tile.className='video-tile';tile.dataset.videoIdentity='late-person';
      document.querySelector('.video-grid').append(tile);GroupMediaPresentation.sync();GroupMediaPresentation.sync();
    }""")
    expect(page.locator('[data-video-identity="late-person"] video')).to_have_count(1)
    assert page.evaluate("__mediaCounts.attach") == 2


@pytest.mark.parametrize("stage,category", [("profile","PROFILE_ERROR"),("voice","STT_ERROR")])
def test_voice_request_failure_is_classified(page, stage, category):
    button = voice_setup(page)
    path = "**/translation/profile" if stage == "profile" else "**/translation/segments/voice"
    page.route(path, lambda r:r.fulfill(status=503,content_type="application/json",body='{"detail":"provider_temporarily_unavailable"}'))
    button.click()
    if stage == "voice":
        expect(button).to_have_attribute("data-voice-icon","save")
        button.click()
    expect(page.locator("[data-v2-error]")).to_have_attribute("data-error-category",category)
    expect(button).to_have_attribute("data-voice-icon","mic")
    if stage == "profile": assert page.evaluate("__recorders") == 0


def test_record_double_click_during_profile_save_is_single_capture(page):
    button = voice_setup(page)
    page.evaluate("""() => {
      const b=document.querySelector('[data-v2-action="record"]');
      b.dispatchEvent(new Event('click'));b.dispatchEvent(new Event('click'));
    }""")
    expect(button).to_have_attribute("data-voice-icon","save")
    assert page.evaluate("__recorders") == 1


def test_radio_translation_preflight_never_requests_floor(page, tmp_path):
    requests=[]
    page.on("request", lambda request:requests.append(request.url))
    boot(page, surface="radio", connected=False)
    page.locator('[data-action="reconnect-radio"]').click()
    page.wait_for_function("GroupV3Runtime.snapshot().media_connected")
    expect(page.locator(".radio-mobile-dock [data-action=start-radio]")).to_be_visible()
    for mode in ["HALF","FULL","HALF","COLLAPSED"]:
        action = "plus" if mode in ["FULL"] or mode == "HALF" and page.locator(".radio-translation-card").get_attribute("data-radio-translation-mode") == "COLLAPSED" else "minus"
        page.locator('[data-workspace-action="radio-translation-'+action+'"]').click()
        expect(page.locator(".radio-translation-card")).to_have_attribute("data-radio-translation-mode",mode)
        expect(page.locator(".radio-mobile-dock [data-action=start-radio]")).to_be_visible()
    page.locator('[data-workspace-action="radio-translation-plus"]').click()
    page.locator('[data-v2-action="record"]').click()
    expect(page.locator("[data-v2-error]")).to_have_attribute("data-error-category","RECORDING_ERROR")
    assert not any("/floor/" in url for url in requests)
    assert page.evaluate("__mediaCounts.acquire") == 0
    page.screenshot(path=str(tmp_path / "radio-preflight.png"))


def test_focus_hide_restore_never_republishes_or_reattaches(page):
    boot(page)
    counts=page.evaluate("({...__mediaCounts})")
    page.locator('.video-tile [data-video-focus=guest]').click()
    expect(page.locator('[data-video-identity=owner]')).to_be_hidden()
    page.locator('.video-tile [data-video-focus=guest]').click()
    expect(page.locator('[data-video-identity=owner]')).to_be_visible()
    page.locator('.video-tile [data-video-hide=guest]').click()
    expect(page.locator('[data-video-identity=guest]')).to_be_hidden()
    page.locator('[data-action=toggle-participant-drawer]').click()
    page.locator('[data-video-restore=guest]').click()
    expect(page.locator('[data-video-identity=guest]')).to_be_visible()
    assert page.evaluate("({...__mediaCounts})") == counts


def test_partial_voice_has_variant_error_and_no_duplicate_source(page):
    button=voice_setup(page)
    item={"id":"partial1","source_language":"vi","source_text":"Source only once","author_view":True,"state":"PARTIAL",
        "variants":[{"target_language":"vi","translated_text":"Source only once","state":"FINAL","recipient_count":0},
        {"target_language":"zh-TW","translated_text":None,"state":"FAILED","recipient_count":1}]}
    page.route("**/translation/segments/voice",lambda r:r.fulfill(content_type="application/json",body=json.dumps({"segment":item})))
    button.click()
    expect(button).to_have_attribute("data-voice-icon","save")
    button.click()
    expect(page.locator("[data-v2-error]")).to_have_attribute("data-error-category","TRANSLATION_VARIANT_ERROR")
    expect(page.locator('[data-variant-language=vi]')).to_have_count(0)
    expect(page.locator('[data-segment-id=partial1] [data-v2-retry]')).to_be_visible()


def test_received_final_auto_read_is_local_and_deduplicated(page):
    voice_setup(page)
    page.evaluate("() => {window.__spoken=[];speechSynthesis.speak=u=>__spoken.push(u.text);speechSynthesis.cancel=()=>{};}")
    page.locator("[data-v2-auto-read]").check()
    page.wait_for_function("GroupV3Runtime.snapshot().auto_read")
    item={"id":"received1","state":"FINAL","translated_text":"Translated fixture","source_text":"Original",
        "speaker_membership_id":"m2","display_language":"zh-TW","target_language":"zh-TW","author_view":False}
    page.route("**/translation/v2-history?*",lambda r:r.fulfill(content_type="application/json",body=json.dumps({"segments":[item]})))
    before=page.evaluate("__mediaCounts.publish")
    for _ in range(2):
        page.evaluate("GroupV3TranslationController.loadHistory(document.querySelector('[data-group-translation-v2]'))")
    assert page.evaluate("__spoken") == ["Translated fixture"]
    assert page.evaluate("__mediaCounts.publish") == before


@pytest.mark.parametrize("width,height",[(390,844),(844,390)])
def test_webkit_workspace_and_visual_viewport(webkit_browser,tmp_path,width,height):
    context=webkit_browser.new_context(viewport={"width":width,"height":height},is_mobile=True,has_touch=True)
    page=context.new_page()
    boot(page,connected=False)
    page.locator('[data-workspace-action=translation-plus]').click()
    expect(page.locator(".translation-dock")).to_have_attribute("data-translation-mode","HALF")
    page.locator('[data-workspace-action=translation-plus]').click()
    expect(page.locator(".translation-dock")).to_have_attribute("data-translation-mode","FULL")
    page.locator('[data-workspace-action=translation-minus]').click()
    page.locator('[data-workspace-action=translation-minus]').click()
    g=geometry(page)
    assert g[".surface-content"]["height"] == height, g
    assert g[".translation-dock"]["bottom"] == height, g
    page.screenshot(path=str(tmp_path / f"webkit-{width}x{height}.png"))
    context.close()
