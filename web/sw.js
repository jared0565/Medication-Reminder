const CACHE='medication-reminder-web-v2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('fetch',event=>event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request))));
self.addEventListener('push',event=>{let data={title:'Medication Reminder',body:'A scheduled reminder is due.'};try{data={...data,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag||'medication-reminder'}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>list.length?list[0].focus():clients.openWindow('./')))});
