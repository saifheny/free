import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, remove, onDisconnect, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAjE-2q6PONBkCin9ZN22gDp9Q8pAH9ZW8",
    authDomain: "story-97cf7.firebaseapp.com",
    databaseURL: "https://story-97cf7-default-rtdb.firebaseio.com",
    projectId: "story-97cf7",
    storageBucket: "story-97cf7.firebasestorage.app",
    messagingSenderId: "742801388214",
    appId: "1:742801388214:web:32a305a8057b0582c5ec17"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let user = JSON.parse(localStorage.getItem('vf_user'));
if (!user) {
    user = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5), code: Math.floor(100 + Math.random() * 900) };
    localStorage.setItem('vf_user', JSON.stringify(user));
}

let localStream, peer, myPeerId, activeRoom;
let audioCtx, audioSource, audioDestination, currentFilter;
let isMuted = false;
let calls = {};
let roomRef = null;
let deferredPrompt;
let roomOwnerId = null;
let knownPeers = new Set();

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(console.log); }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.getElementById('install-popup').classList.add('show'); });

window.triggerInstall = async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('install-popup').classList.remove('show');
    }
};
window.closeInstallPopup = () => document.getElementById('install-popup').classList.remove('show');

window.onload = () => {
    document.getElementById('id-text').innerHTML = `معرفك: ${user.code}`;
    const urlRoom = new URLSearchParams(location.search).get('room');
    if(urlRoom) { 
        activeRoom = urlRoom; 
        localStorage.setItem('last_room', activeRoom); 
        document.getElementById('audio-gate').classList.add('show'); 
    }
    updateUI();
};

function updateUI() {
    const last = localStorage.getItem('last_room');
    const btn = document.getElementById('btn-rejoin');
    if(last) { 
        btn.style.opacity = '1'; 
        btn.style.pointerEvents = 'all';
        document.getElementById('last-room-txt').innerText = "غرفة: " + last; 
        btn.onclick = rejoinLastRoom; 
    } else { 
        btn.style.opacity = '0.4'; 
        btn.style.pointerEvents = 'none';
    }
}

let toastTimeout;
window.showToast = (msg) => {
    const container = document.getElementById('toast-container');
    container.innerHTML = '';
    clearTimeout(toastTimeout);
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if(toast.parentElement) toast.remove(); }, 200);
    }, 2500);
};

window.openShareSheet = () => { document.getElementById('share-overlay').classList.add('show'); document.getElementById('share-sheet').classList.add('show'); };
window.closeShareSheet = () => { document.getElementById('share-overlay').classList.remove('show'); document.getElementById('share-sheet').classList.remove('show'); };

window.copyLinkAction = () => {
    const link = `${location.origin}${location.pathname}?room=${activeRoom}`;
    navigator.clipboard.writeText(link).then(() => { showToast("تم نسخ رابط الغرفة"); closeShareSheet(); });
};

window.shareTo = (platform) => {
    const link = `${location.origin}${location.pathname}?room=${activeRoom}`;
    const text = `انضم للنقاش الصوتي المباشر على منبر الأحرار: `;
    const urls = {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(text + link)}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`
    };
    if(urls[platform]) window.open(urls[platform], '_blank');
    closeShareSheet();
};

window.createNewRoom = () => { 
    activeRoom = Math.random().toString(36).substr(2, 6).toUpperCase(); 
    localStorage.setItem('last_room', activeRoom); 
    set(ref(db, `rooms/${activeRoom}/owner`), user.id);
    document.getElementById('audio-gate').classList.add('show'); 
};

window.rejoinLastRoom = () => { 
    activeRoom = localStorage.getItem('last_room'); 
    document.getElementById('audio-gate').classList.add('show'); 
};

const joinSound = new Audio("data:audio/mp3;base64,//uQRAAAAWMSLwUIYAPAAAAAAAAAAAAAFhpZgAAgiXYAD//uQRAAAAWMSLwUIYAPAAAAAAAAAAAAAFhpZgAAgiXYAD//uQRAAAAWMSLwUIYAPAAAAAAAAAAAAAFhpZgAAgiXYAD//uQZAAAAzgLgAAAAABBQAAABCRU5E");
joinSound.volume = 0.5;

window.confirmEntry = async () => {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if(audioCtx.state === 'suspended') await audioCtx.resume();
        
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
                channelCount: 1
            },
            video: false 
        });

        audioSource = audioCtx.createMediaStreamSource(localStream);
        audioDestination = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDestination);
        
        const peerConfig = {
            debug: 0,
            config: {
                iceServers: [
                  { urls: "stun:stun.relay.metered.ca:80" },
                  { urls: "turn:global.relay.metered.ca:80", username: "14d6a892afc9dbe41c8e0de2", credential: "jWoQ1RL0jVlh/dNY" },
                  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "14d6a892afc9dbe41c8e0de2", credential: "jWoQ1RL0jVlh/dNY" },
                  { urls: "turn:global.relay.metered.ca:443", username: "14d6a892afc9dbe41c8e0de2", credential: "jWoQ1RL0jVlh/dNY" },
                  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "14d6a892afc9dbe41c8e0de2", credential: "jWoQ1RL0jVlh/dNY" }
                ]
            }
        };

        peer = new Peer(user.id, peerConfig);

        peer.on('open', id => { myPeerId = id; startRoom(); });
        
        peer.on('call', call => {
            call.answer(audioDestination.stream);
            call.on('stream', stream => handleRemoteStream(stream, call.peer));
            calls[call.peer] = call;
        });
        
        peer.on('error', err => { 
            console.error(err); 
            if(err.type === 'peer-unavailable') {
                showToast("المستخدم غير متصل حالياً");
            } else {
                showToast("جاري محاولة إعادة الاتصال..."); 
            }
        });

        document.getElementById('audio-gate').classList.remove('show');
        document.getElementById('v-home').classList.remove('active');
        document.getElementById('v-room').classList.add('active');
        window.history.pushState({}, '', `?room=${activeRoom}`);
        
        knownPeers.clear();
        knownPeers.add(user.id);

    } catch(e) { 
        console.error(e);
        showToast("يرجى السماح باستخدام المايكروفون"); 
    }
};

function startRoom() {
    roomRef = ref(db, `rooms/${activeRoom}/users/${user.id}`);
    set(roomRef, { code: user.code, peerId: myPeerId, online: true, isMuted: false });
    onDisconnect(roomRef).remove();

    get(ref(db, `rooms/${activeRoom}/owner`)).then((snap) => {
        if(snap.exists()) {
            roomOwnerId = snap.val();
        } else {
            set(ref(db, `rooms/${activeRoom}/owner`), user.id);
            roomOwnerId = user.id;
        }
    });

    onValue(ref(db, `rooms/${activeRoom}/users`), (snap) => {
        const users = snap.val() || {};
        
        if (document.getElementById('v-room').classList.contains('active') && !users[user.id]) {
            showToast("تم إخراجك من الغرفة");
            setTimeout(exitToMenu, 1000);
            return;
        }

        Object.keys(users).forEach(uid => {
            if (!knownPeers.has(uid)) {
                knownPeers.add(uid);
                try {
                    document.getElementById('join-sound').play().catch(e => console.log(e));
                } catch(e) {}
            }
        });

        renderUsers(users);
        Object.values(users).forEach(u => {
            if(u.peerId !== myPeerId && !calls[u.peerId]) {
                const call = peer.call(u.peerId, audioDestination.stream);
                call.on('stream', stream => handleRemoteStream(stream, u.peerId));
                calls[u.peerId] = call;
            }
        });
    });
}

window.kickUser = (targetUserId) => {
    if(confirm("هل أنت متأكد من طرد هذا المستخدم؟")) {
        remove(ref(db, `rooms/${activeRoom}/users/${targetUserId}`))
        .then(() => showToast("تم طرد المستخدم"))
        .catch(e => console.error(e));
    }
};

function handleRemoteStream(stream, peerId) {
    let audio = document.getElementById('audio-' + peerId);
    if(!audio) {
        audio = document.createElement('audio');
        audio.id = 'audio-' + peerId;
        audio.autoplay = true;
        audio.playsInline = true;
        document.getElementById('audio-container').appendChild(audio);
    }
    audio.srcObject = stream;
    
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log("Audio play failed, retrying...");
        });
    }

    try {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const remoteCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = remoteCtx.createMediaStreamSource(stream);
        monitorVolume(source, peerId, remoteCtx);
    } catch(e) { console.log(e); }
}

function monitorVolume(source, id, context) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    
    const check = () => {
        if(!document.getElementById('v-room').classList.contains('active')) return;
        analyser.getByteFrequencyData(data);
        const vol = data.reduce((a,b) => a+b) / data.length;
        
        const waveContainer = document.getElementById('wave-' + id);
        if(waveContainer) {
            if(vol > 10) waveContainer.classList.add('speaking');
            else waveContainer.classList.remove('speaking');
        }
        requestAnimationFrame(check);
    };
    check();
}

function renderUsers(users) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    const list = Object.entries(users);
    grid.className = 'grid-container ' + (list.length <= 1 ? 'layout-1' : list.length === 2 ? 'layout-2' : 'layout-more');
    
    const isOwner = (user.id === roomOwnerId);

    list.forEach(([uid, u]) => {
        const isMe = u.peerId === myPeerId;
        const muteBadge = u.isMuted ? '<div class="mute-badge"><i class="fas fa-microphone-slash"></i></div>' : '';
        
        const kickBtn = (isOwner && !isMe) ? 
            `<div class="kick-btn" onclick="kickUser('${uid}')"><i class="fas fa-times"></i></div>` : '';

        grid.innerHTML += `
            <div class="user-card">
                ${kickBtn}
                <div class="card-avatar">
                    ${u.code}
                    ${muteBadge}
                </div>
                <div class="voice-wave-container" id="wave-${u.peerId}">
                    <div class="wave-bar"></div><div class="wave-bar"></div>
                    <div class="wave-bar"></div><div class="wave-bar"></div>
                </div>
                <div style="font-size:0.75rem; color:#666; margin-top:10px; font-weight:600;">${isMe ? 'أنت' : 'متحدث'}</div>
            </div>
        `;
    });
    if(audioSource) monitorVolume(audioSource, myPeerId, audioCtx);
}

window.toggleMic = () => {
    isMuted = !isMuted;
    if(localStream) localStream.getAudioTracks()[0].enabled = !isMuted;
    if(roomRef) { update(roomRef, { isMuted: isMuted }); }

    const btn = document.getElementById('mic-btn');
    if(isMuted) {
        btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        btn.classList.remove('active');
    } else {
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        btn.classList.add('active');
    }
    showToast(isMuted ? "تم كتم الصوت" : "أنت متصل الآن");
};

window.exitToMenu = () => {
    window.open('https://www.effectivegatecpm.com/k8fisnjjc?key=afa7ea920578f74cea5997d670bbe78e', '_blank');

    if (roomRef) remove(roomRef);
    if(localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (peer) { peer.destroy(); peer = null; }
    
    calls = {}; myPeerId = null; activeRoom = null; isMuted = false;
    document.getElementById('audio-container').innerHTML = '';
    
    document.getElementById('v-room').classList.remove('active');
    document.getElementById('v-home').classList.add('active');
    window.history.replaceState({}, document.title, window.location.pathname);
    updateUI();
};

window.toggleFilters = () => document.getElementById('filter-menu').classList.toggle('show');

window.applyFilter = (type, el) => {
    document.querySelectorAll('.filter-opt').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('filter-menu').classList.remove('show');
    
    audioSource.disconnect();
    if(currentFilter) { currentFilter.disconnect(); currentFilter = null; }
    
    if(type === 'none') {
        audioSource.connect(audioDestination);
    } else if(type === 'deep') {
        const f = audioCtx.createBiquadFilter(); 
        f.type = 'lowshelf'; f.frequency.value = 200; f.gain.value = 10;
        audioSource.connect(f); f.connect(audioDestination); currentFilter = f;
    } else if(type === 'echo') {
        const delay = audioCtx.createDelay(); delay.delayTime.value = 0.15;
        const feedback = audioCtx.createGain(); feedback.gain.value = 0.2;
        delay.connect(feedback); feedback.connect(delay);
        audioSource.connect(audioDestination);
        audioSource.connect(delay); delay.connect(audioDestination);
        currentFilter = delay;
    }
    showToast("تم تفعيل الفلتر");
};
