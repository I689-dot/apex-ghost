/* global document, location */
// GridCorsa website: the small things a static page needs.
(() => {
  // invite links from before the game moved to /play/ (…/?join=CODE): into the game with the code
  const q = new URLSearchParams(location.search);
  if (q.has('join') && !location.pathname.startsWith('/play')) {
    location.replace(`/play/?join=${encodeURIComponent(q.get('join') || '')}`);
    return;
  }

  // the phone menu
  const burger = document.querySelector('.burger');
  const nav = document.querySelector('.nav');
  burger?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });

  // the cars page: by make, and a search
  const grid = document.querySelector('[data-cars]');
  if (grid) {
    const cards = [...grid.querySelectorAll('[data-make]')];
    const buttons = [...document.querySelectorAll('[data-filter]')];
    const search = document.querySelector('[data-search]');
    let make = '';
    const apply = () => {
      const s = (search?.value || '').trim().toLowerCase();
      for (const c of cards) c.hidden = (make && c.dataset.make !== make) || (s && !c.dataset.text.includes(s));
      for (const b of buttons) b.classList.toggle('on', b.dataset.filter === make);
    };
    for (const b of buttons)
      b.addEventListener('click', () => {
        make = b.dataset.filter;
        apply();
      });
    search?.addEventListener('input', apply);
  }

  // screenshots: full size on click
  for (const a of document.querySelectorAll('.gallery a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const box = document.createElement('div');
      box.className = 'lightbox';
      const img = document.createElement('img');
      img.src = a.getAttribute('href');
      img.alt = a.getAttribute('aria-label') || '';
      box.append(img);
      const close = () => box.remove();
      box.addEventListener('click', close);
      document.addEventListener('keydown', (k) => k.key === 'Escape' && close(), { once: true });
      document.body.append(box);
    });
  }
})();
