const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();

function message(text) { $('message').textContent = text; }
function invoke(endpoint, data = {}) {
  return new Promise((resolve, reject) => {
    if (!tg?.Serverless?.call) return reject(new Error('برنامه را از داخل تلگرام باز کنید.'));
    tg.Serverless.call(endpoint, data, (error, value) =>
      error ? reject(new Error(error.message || 'خطای تلگرام')) : resolve(value));
  });
}
function connection(online, label) {
  $('indicator').classList.toggle('online', online);
  $('connection').textContent = label;
}
async function refresh() {
  $('refresh').disabled = true;
  message('');
  try {
    const value = await invoke('getStatus');
    const cards = $('channels');
    cards.replaceChildren();
    if (!value.connected) {
      connection(false, 'متصل نیست');
      message('برای شروع، تنظیمات اتصال به موتور StreamCore را ثبت کنید.');
      return;
    }
    connection(true, 'متصل');
    $('cpu').textContent = value.system?.cpu != null ? value.system.cpu + '%' : '—';
    $('ram').textContent = value.system?.ram != null ? value.system.ram + '%' : '—';
    if (value.baseUrl) $('baseUrl').value = value.baseUrl;
    if (!value.channels?.length) {
      const p = document.createElement('p'); p.className = 'hint';
      p.textContent = 'هنوز کانالی تعریف نشده است.'; cards.append(p);
    }
    for (const channel of value.channels || []) {
      const card = document.createElement('article'); card.className = 'channel';
      const top = document.createElement('div'); top.className = 'ch-top';
      const name = document.createElement('p'); name.className = 'ch-title';
      name.textContent = channel.name;
      const state = document.createElement('span');
      state.className = 'state' + (channel.running ? ' running' : '');
      state.textContent = channel.running ? '● در حال پخش' :
        (channel.desired ? '◌ در حال راه‌اندازی' : '○ متوقف');
      top.append(name, state);
      const slug = document.createElement('p'); slug.className = 'ch-id';
      slug.textContent = channel.id;
      const buttons = document.createElement('div'); buttons.className = 'buttons';
      for (const operation of ['start', 'stop']) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = operation === 'stop' ? 'danger' : '';
        btn.textContent = operation === 'start' ? '▶ شروع' : '■ توقف';
        btn.disabled = Boolean(channel.desired) === (operation === 'start');
        btn.addEventListener('click', async () => {
          const verb = operation === 'start' ? 'شروع' : 'توقف';
          if (!window.confirm(verb + ' پخش «' + channel.name + '»؟')) return;
          btn.disabled = true;
          try {
            await invoke('controlChannel', { channel: channel.id, operation });
            await refresh();
            message('دستور ' + verb + ' پذیرفته شد. نتیجه نهایی را در تلگرام بررسی کنید.');
          } catch (err) { message(err.message); }
          finally { btn.disabled = false; }
        });
        buttons.append(btn);
      }
      card.append(top, slug, buttons);
      cards.append(card);
    }
  } catch (err) { connection(false, 'عدم دسترسی'); message(err.message); }
  finally { $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
$('connectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await invoke('saveConnection', { baseUrl: $('baseUrl').value, token: $('token').value });
    message('اتصال ذخیره شد.');
    await refresh();
  } catch (err) { message(err.message); }
  finally {
    $('token').value = '';
    button.disabled = false;
  }
});
refresh();
