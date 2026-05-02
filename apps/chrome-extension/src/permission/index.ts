/**
 * One-time microphone permission grant page. Runs in a real extension tab
 * (chrome.tabs.create), so Chrome's permission prompt UI actually appears
 * and persists. Once granted, the offscreen audio worker can call
 * navigator.mediaDevices.getUserMedia silently with the same permission.
 */
const button = document.getElementById('grant') as HTMLButtonElement | null;
const statusEl = document.getElementById('status') as HTMLParagraphElement | null;

if (button && statusEl) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    statusEl.textContent = 'Requesting…';
    statusEl.className = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      statusEl.textContent = 'Microphone granted. You can close this tab and return to Meet.';
      statusEl.className = 'ok';
      button.textContent = 'Granted';
    } catch (err) {
      statusEl.textContent = `Denied: ${(err as Error).message}. Try again or check chrome://settings/content/microphone.`;
      statusEl.className = 'err';
      button.disabled = false;
    }
  });
}
