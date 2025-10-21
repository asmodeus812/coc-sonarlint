// noncompliant_avoid_var.js
// Noncompliant: using `var` (old-style hoisted variable declaration)

function counter() {
  for (var i = 0; i < 3; i++) {
    setTimeout(function () {
      console.log(i);
    }, 10);
  }
}

var x = 10;
if (x > 5) {
  var y = x * 2;
}
console.log(y); // `y` is accessible here due to var hoisting (surprising)
