const form = document.querySelector('#passkey');
const id = document.querySelector('#login');
const code = document.querySelector('#code');
const message = document.querySelector('#login-message');
try { id.value = localStorage.getItem('worker-id') || ''; } catch {}

async function post(path, data) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error);
  return result;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = 'Telefon tasdig‘i kutilmoqda…';
  try {
    if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) {
      throw new Error('Bu brauzerda kirish kaliti ishlamayapti. HTTPS orqali zamonaviy brauzerda oching.');
    }
    const { registration, options } = await post('/auth/options', { login: id.value, code: code.value });
    const { startRegistration, startAuthentication } = window.SimpleWebAuthnBrowser;
    const response = registration ? await startRegistration({ optionsJSON: options }) :
      await startAuthentication({ optionsJSON: options });
    await post('/auth/verify', { response });
    try { localStorage.setItem('worker-id', id.value.trim()); } catch {}
    window.location.replace('/');
  } catch (error) {
    message.textContent = error.name === 'NotAllowedError' ? 'Tasdiqlash bekor qilindi. Qayta urinib ko‘ring.' : error.message;
    button.disabled = false;
  }
});
