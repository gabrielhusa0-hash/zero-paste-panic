// Pomocné funkce pro šifrování a správu elementů
const els = {
    contentInput: document.getElementById('content-input'),
    createBtn: document.getElementById('create-btn'),
    createError: document.getElementById('create-error'),
    resultBox: document.getElementById('result-box'),
    resultLink: document.getElementById('result-link'),
    
    viewContentBox: document.getElementById('view-content-box'),
    viewContent: document.getElementById('view-content'),
    viewLoading: document.getElementById('view-loading'),
    viewError: document.getElementById('view-error'),
    burnNotice: document.getElementById('burn-notice'),
    countdownEl: document.getElementById('countdown')
};

// Bezpečnostní pomocná funkce proti XSS
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Funkce pro konverzi
function ab2str(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}

function str2ab(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// Import klíče
async function importKey(keyBase64) {
    const keyBuffer = str2ab(keyBase64);
    return await window.crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-GCM" },
        true,
        ["decrypt"]
    );
}

// Dešifrování textu
async function decryptText(ciphertext, iv, key) {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decryptedBuffer);
}

// Logika pro vytvoření tajemství na index.html
if (els.createBtn) {
    els.createBtn.addEventListener('click', async () => {
        const text = els.contentInput.value;
        if (!text) {
            els.createError.textContent = 'Sem napiš nějaký text!';
            return;
        }
        els.createError.textContent = '';

        try {
            const key = await window.crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );

            const exportedKey = await window.crypto.subtle.exportKey("raw", key);
            const keyBase64 = ab2str(exportedKey);

            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encodedText = new TextEncoder().encode(text);
            const ciphertext = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                encodedText
            );

            // Odeslání na správný endpoint /api/paste podle server.js
            const response = await fetch('/api/paste', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ciphertext: ab2str(ciphertext), 
                    iv: ab2str(iv),
                    burnAfterRead: document.getElementById('burn-checkbox').checked,
                    expiresInMinutes: document.getElementById('expiry-select').value ? Number(document.getElementById('expiry-select').value) : null
                })
            });

            const data = await response.json();
            if (data.id) {
                const link = `${window.location.origin}/p/${data.id}#${keyBase64}`;
                els.resultBox.classList.remove('hidden');
                els.resultLink.value = link;
                els.contentInput.disabled = true;
                els.createBtn.classList.add('hidden');

                // Přidání funkce pro kliknutí na tlačítko "Otevřít"
                const openBtn = document.getElementById('open-btn');
                if (openBtn) {
                    openBtn.onclick = () => {
                        window.open(link, '_blank');
                    };
                }
            } else {
                els.createError.textContent = data.error || 'Chyba při vytváření.';
            }
        } catch (err) {
            console.error(err);
            els.createError.textContent = 'Chyba při šifrování.';
        }
    });
}

// Logika pro zobrazení na view.html
async function handleView(id, keyBase64) {
    try {
        const response = await fetch(`/api/paste/${id}`);
        const data = await response.json();

        if (!response.ok) {
            els.viewError.textContent = data.error || 'Poznámka neexistuje.';
            els.viewError.classList.remove('hidden');
            return;
        }

        const ciphertext = str2ab(data.ciphertext);
        const iv = str2ab(data.iv);

        const key = await importKey(keyBase64);
        const plaintext = await decryptText(ciphertext, iv, key);

        // Schováme loading
        if (els.viewLoading) {
            els.viewLoading.classList.add('hidden');
        }

        // Okamžitě ukážeme zprávu s odpočtem v celoobrazovkovém okně
        startSelfDestructCountdown(plaintext);

    } catch (err) {
        if (els.viewLoading) els.viewLoading.classList.add('hidden');
        els.viewError.textContent = err.name === 'OperationError' 
            ? 'Dešifrování selhalo – chybí nebo je poškozený klíč.' 
            : 'Něco se nepovedlo.';
        els.viewError.classList.remove('hidden');
    }
}

function startSelfDestructCountdown(plaintext) {
    let secondsLeft = 5;

    // Vytvoříme celoobrazovkový prvek, kde bude vidět zpráva i odpočet
    const screen = document.createElement('div');
    screen.style.position = 'fixed';
    screen.style.top = '0';
    screen.style.left = '0';
    screen.style.width = '100vw';
    screen.style.height = '100vh';
    screen.style.backgroundColor = '#0b0b0b';
    screen.style.color = '#00ff00';
    screen.style.fontFamily = 'monospace';
    screen.style.padding = '40px';
    screen.style.boxSizing = 'border-box';
    screen.style.zIndex = '999999';
    screen.style.overflowY = 'auto';

    // Funkce pro vykreslení stavu odpočtu a zprávy
    const renderContent = (secs) => {
        screen.innerHTML = `
            <div style="max-width: 800px; margin: 0 auto; border: 1px solid #333; padding: 20px; background: #000; box-shadow: 0 0 20px rgba(0,255,0,0.1);">
                <h3 style="margin-top: 0; color: #ff5555; border-bottom: 1px solid #333; padding-bottom: 10px;">DEŠIFROVANÁ ZPRÁVA</h3>
                <div style="background: #111; padding: 15px; border: 1px solid #222; font-size: 16px; white-space: pre-wrap; word-break: break-all; margin-bottom: 20px; color: #fff;">${escapeHtml(plaintext)}</div>
                <div style="color: #ffaa00; font-weight: bold; margin-bottom: 20px;">Systém zkolabuje a zpráva zmizí za ${secs} sekund...</div>
            </div>
        `;
    };

    renderContent(secondsLeft);
    document.body.appendChild(screen);

    const interval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
            renderContent(secondsLeft);
        } else {
            clearInterval(interval);
            
            // Po 5 sekundách naskočí natvrdo SSHRD Panic
            screen.style.backgroundColor = '#000';
            screen.style.cursor = 'pointer';
            screen.innerHTML = `
                <pre style="color: #00ff00; line-height: 1.1; font-size: 14px; margin: 0 0 20px 0;">
  .-'-.
 /     \\
 | 0 0 |
 |  v  |
 \\     /
  '-.-'
                </pre>
                <div style="font-size: 14px; line-height: 1.5; color: #00ff00;">
                    PANIC: CPU 0 caller 0xfffffff00702d4c0: "usb stack forced panic"<br>
                    Debugger called: &lt;panic&gt;<br>
                    VM buffer: 0xffffff8012345678, file: /AppleInternal/BuildRoot/Library/Caches/com.apple.xbs/Sources/xnu/xnu-7195.141.2/bsd/kern/kern_shield.c, line 412<br>
                    <br>
                    Apple Credential Manager: critical storage sector unreadable.<br>
                    hfs_mount: ffs_mount failed with error 10<br>
                    Root filesystem partition signature invalid or unmounted.<br>
                    RAMdisk mounted successfully at /dev/disk0s1, but physical store refused secure handshake.<br>
                    <br>
                    Backtrace (CPU 0):<br>
                    0x-fffffff00702d4c0 0x-fffffff006f81a8c 0x-fffffff006f81520<br>
                    <br>
                    FATAL EXCEPTION: System halted. All memory cleared.<br>
                    <span style="color: #666; font-size: 12px; display: inline-block; margin-top: 20px;">[ Klikněte kamkoliv nebo stiskněte libovolnou klávesu pro návrat ]</span>
                </div>
            `;

            const exitPanic = () => {
                window.removeEventListener('keydown', exitPanic);
                screen.removeEventListener('click', exitPanic);
                window.location.href = '/';
            };

            window.addEventListener('keydown', exitPanic);
            screen.addEventListener('click', exitPanic);
        }
    }, 1000);
}

// Router
function init() {
    const match = location.pathname.match(/\/p\/([^\/]+)$/) || location.search.match(/id=([^&]+)/);
    const keyB64 = location.hash.slice(1);
    const id = match ? match[1] : null;

    if (id && keyB64) {
        handleView(id, keyB64);
    } else {
        if (els.viewLoading) els.viewLoading.classList.add('hidden');
        if (els.viewError) {
            els.viewError.textContent = 'Neplatný odkaz.';
            els.viewError.classList.remove('hidden');
        }
    }
}

if (location.pathname.includes('view.html') || location.pathname.includes('/p/')) {
    init();
}