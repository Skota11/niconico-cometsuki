chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-recording') return;

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab || !tab.id) return;

        try {
            const tabUrl = tab.url || '';
            const parsed = new URL(tabUrl);
            const host = (parsed.hostname || '').toLowerCase();
            const allowed = host === 'nicovideo.jp' || host.endsWith('.nicovideo.jp');
            if (!allowed) {
                try {
                    chrome.notifications.create('', {
                        type: 'basic',
                        title: 'ショートカットの制限',
                        message: 'このショートカットは nicovideo.jp のページでのみ使用できます。'
                    });
                } catch (e) {
                    // ignore
                }
                return;
            }
        } catch (e) {
            // ignore
            return;
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                try {
                    if (window.vcm_vcmController && typeof window.vcm_vcmController.stop === 'function') {
                        window.vcm_vcmController.stop();
                        return { stopped: true };
                    }
                } catch (e) {
                    return { error: String(e) };
                }
                return { stopped: false };
            }
        });

        const value = Array.isArray(result) && result[0] && result[0].result ? result[0].result : null;
        if (value && value.stopped) {
            return;
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (q, f) => {
                window.extensionQualitySetting = q;
                window.extensionFormatSetting = f;
            },
            args: ['medium', 'mp4']
        });

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
    } catch (err) {
        console.error('Error toggling recording:', err);
    }
});
