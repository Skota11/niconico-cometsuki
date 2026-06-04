(async function () {
    // 要素の取得
    const video = document.querySelector('video');
    let userCanvas = null;
    for (const c of document.querySelectorAll('canvas')) {
        if (c.clientWidth > 0 && c.clientHeight > 0) userCanvas = c;
    }

    if (!video || !userCanvas) {
        alert('video または canvas 要素が見つかりません。');
        return;
    }

    // 設定の読み込み
    const quality = window.extensionQualitySetting || 'medium';
    const format = window.extensionFormatSetting || 'mp4';
    const QUALITY_PRESETS = {
        low: { videoBitrate: 2_000_000, audioBitrate: 128_000, scale: 1.0, fps: 30 },
        medium: { videoBitrate: 6_000_000, audioBitrate: 192_000, scale: 1.0, fps: 60 },
        high: { videoBitrate: 10_000_000, audioBitrate: 256_000, scale: 1.5, fps: 60 },
    };
    const { videoBitrate, audioBitrate, scale, fps } =
        QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.medium;
    const mp4Candidates = [
        'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
        'video/mp4; codecs=h264',
        'video/mp4',
    ];
    const webmCandidates = [
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8',
        'video/webm',
    ];

    let chosenMimeType;
    if (format === 'mp4') {
        chosenMimeType = mp4Candidates.find(t => MediaRecorder.isTypeSupported(t));
        if (!chosenMimeType) {
            console.warn('[ニコニココメ付き] MP4非対応のためWebMで録画します。');
            chosenMimeType = webmCandidates.find(t => MediaRecorder.isTypeSupported(t));
        }
    } else {
        chosenMimeType = webmCandidates.find(t => MediaRecorder.isTypeSupported(t));
    }
    chosenMimeType = chosenMimeType ?? 'video/webm';

    const fileExtension = chosenMimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

    // マージCanvasの作成
    const baseWidth = video.videoWidth || video.clientWidth;
    const baseHeight = video.videoHeight || video.clientHeight;

    const mergeCanvas = document.createElement('canvas');
    mergeCanvas.width = Math.round(baseWidth * scale);
    mergeCanvas.height = Math.round(baseHeight * scale);
    const ctx = mergeCanvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = quality === 'low' ? 'low' : 'medium';

    // プレビュー表示
    Object.assign(mergeCanvas.style, {
        position: 'fixed', bottom: '20px', right: '20px',
        width: '240px', zIndex: '999997',
        border: '3px solid #ff0055', borderRadius: '6px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
    });
    document.body.appendChild(mergeCanvas);

    // ビデオストリームの取得
    const srcStream = (video.captureStream ?? video.mozCaptureStream)?.call(video);
    if (!srcStream) {
        alert('[ニコニココメ付き] ビデオストリームの取得に失敗しました。');
        mergeCanvas.remove();
        return;
    }

    const originalVideoTrack = srcStream.getVideoTracks()[0];
    const audioTrack = srcStream.getAudioTracks()[0];

    if (!originalVideoTrack) {
        alert('[ニコニココメ付き] ビデオトラックが見つかりません。リロードして再度お試しください。');
        mergeCanvas.remove();
        return;
    }

    const processor = new MediaStreamTrackProcessor({ track: originalVideoTrack });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });

    const reader = processor.readable.getReader();
    const writer = generator.writable.getWriter();

    let isRecording = true;
    let lastFrameTime = null;
    const frameInterval = 1000 / fps;

    async function processFrames() {
        try {
            while (isRecording) {
                const { value: frame, done } = await reader.read();
                if (done) break;
                if (!isRecording) {
                    frame.close();
                    break;
                }

                if (quality === 'low') {
                    const currentTimeMs = frame.timestamp / 1000;
                    if (lastFrameTime !== null && (currentTimeMs - lastFrameTime < frameInterval - 2)) {
                        frame.close();
                        continue;
                    }
                    lastFrameTime = currentTimeMs;
                }

                ctx.clearRect(0, 0, mergeCanvas.width, mergeCanvas.height);
                ctx.drawImage(frame, 0, 0, mergeCanvas.width, mergeCanvas.height);
                ctx.drawImage(userCanvas, 0, 0, mergeCanvas.width, mergeCanvas.height);

                const newFrame = new VideoFrame(mergeCanvas, {
                    timestamp: frame.timestamp,
                    duration: frame.duration ?? undefined
                });

                frame.close();

                await writer.write(newFrame);
            }
        } catch (err) {
            console.error('[ニコニココメ付き] フレーム処理ループでエラー:', err);
        } finally {
            try { writer.close(); } catch (_) { }
            try { reader.releaseLock(); } catch (_) { }
        }
    }
    processFrames();

    // 録画用ストリームの作成
    const recordingStream = new MediaStream();
    recordingStream.addTrack(generator);
    if (audioTrack) {
        recordingStream.addTrack(audioTrack);
    }

    // MediaRecorder
    const chunks = [];
    const recorder = new MediaRecorder(recordingStream, {
        mimeType: chosenMimeType,
        videoBitsPerSecond: videoBitrate,
        audioBitsPerSecond: audioBitrate,
    });
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };

    // Expose a minimal controller so external callers (background/commands) can stop the recording.
    // This keeps the existing behavior but allows keyboard shortcuts to toggle stop.
    try {
        window.vcm_vcmController = {
            stop: () => {
                try { recorder.stop(); } catch (e) { console.warn('vcm: stop error', e); }
            },
            isRecording: () => !!(typeof isRecording !== 'undefined' ? isRecording : false),
        };
    } catch (e) {
        console.warn('[ニコニココメ付き] コントローラを公開できませんでした:', e);
    }

    // UIの表示・更新
    const uiHtml = await fetch(chrome.runtime.getURL('recording_ui.html')).then(r => r.text());
    const uiWrapper = document.createElement('div');
    uiWrapper.innerHTML = uiHtml;
    document.body.appendChild(uiWrapper);

    const el = id => document.getElementById(id);
    if (el('vcm-status-text')) el('vcm-status-text').innerText = fileExtension.toUpperCase();
    if (el('vcm-quality-text')) el('vcm-quality-text').innerText = quality.toUpperCase();

    let seconds = 0;
    const timerInterval = setInterval(() => {
        seconds++;
        const t = el('vcm-timer');
        if (t) t.innerText = `経過時間: ${seconds}秒`;
    }, 1000);

    // 停止・保存処理
    recorder.onstop = () => {
        isRecording = false;
        clearInterval(timerInterval);
        uiWrapper.remove();
        mergeCanvas.remove();

        // トラックの完全停止と解放
        try { generator.stop(); } catch (_) { }
        try { originalVideoTrack.stop(); } catch (_) { }
        if (audioTrack) { try { audioTrack.stop(); } catch (_) { } }

        const blob = new Blob(chunks, { type: chosenMimeType });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
            href: url,
            download: `${quality}-${Date.now()}.${fileExtension}`,
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Cleanup exposed controller when recording stops
    try {
        if (window.vcm_vcmController) delete window.vcm_vcmController;
    } catch (e) { /* ignore */ }

    el('vcm-stop-btn')?.addEventListener('click', () => recorder.stop());

    // 録画開始
    await video.play().catch(err => console.warn('[ニコニココメ付き] 自動再生に失敗しました:', err));
    recorder.start();

    console.log(
        `[ニコニココメ付き] 録画開始 | codec=${chosenMimeType}`,
        `| video=${videoBitrate / 1e6}Mbps | audio=${audioBitrate / 1e3}kbps | scale=${scale}x | target_fps=${fps}`
    );
})();