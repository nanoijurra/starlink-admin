if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js');
      console.log('Service worker registrado.', registration.scope);
    } catch (error) {
      console.warn('No se pudo registrar el service worker.', error);
    }
  });
}
