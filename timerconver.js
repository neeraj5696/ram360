const timestamp = 1769487467;

// convert seconds → milliseconds
const date = new Date(timestamp * 1000);

// format: YYYY-MM-DD HH:mm
const formatted =
  date.getFullYear() + '-' +
  String(date.getMonth() + 1).padStart(2, '0') + '-' +
  String(date.getDate()).padStart(2, '0') + ' ' +
  String(date.getHours()).padStart(2, '0') + ':' +
  String(date.getMinutes()).padStart(2, '0');

console.log(formatted);
