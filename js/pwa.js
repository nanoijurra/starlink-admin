if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js');
      console.log('Service Worker registrado', registration.scope);
    } catch (error) {
      console.warn('Error registrando Service Worker', error);
    }
  });
}
