export function memberIdFromCookies(cookies) {
  for (const name of ['STUDY_INFO', 'NETEASE_WDA_UID']) {
    const raw = cookies.find((cookie) => cookie.name === name)?.value;
    if (!raw) continue;
    let value;
    try { value = decodeURIComponent(raw); } catch { continue; }
    const part = name === 'STUDY_INFO' ? value.split('|')[2] : value.split('|')[0]?.replace(/^#/, '');
    if (/^\d{6,20}$/.test(part || '')) return part;
  }
  return null;
}
