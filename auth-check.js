(function () {
  if (localStorage.getItem('odoj_access') !== 'granted') {
    window.location.replace('gate.html');
  }
})();
