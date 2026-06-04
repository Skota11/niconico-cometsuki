document.getElementById('startBtn').addEventListener('click', async () => {
    const quality = document.querySelector('input[name="quality"]:checked').value;
    const format = document.querySelector('input[name="format"]:checked').value;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (q, f) => {
            window.extensionQualitySetting = q;
            window.extensionFormatSetting = f;
        },
        args: [quality, format],
    });

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
    });

    window.close();
});