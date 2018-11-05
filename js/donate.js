$(function() {
  var donateQr = (window.donateQr = new QRious({
    element: document.getElementById("donateQr"),
    size: 124,
    value: ""
  }));
});

function show(element) {
  element.style.display = "block";
}

function hide(element) {
  element.style.display = "none";
}

var prevAddressNode = null;

function showDonateQr(sourceObj) {
  if (prevAddressNode != null) {
    prevAddressNode.style.backgroundColor = "";
  }
  prevAddressNode = sourceObj.children[0];

  donateQr.value = sourceObj.innerText;
  donateQr.element.style.left =
    sourceObj.offsetLeft +
    sourceObj.offsetParent.offsetLeft +
    prevAddressNode.offsetLeft +
    "px";

  //the sums of top location gives correct QR location
  donateQr.element.style.top =
    sourceObj.parentNode.parentNode.parentNode.offsetTop + //table top location
    sourceObj.offsetTop + //table row top location
    prevAddressNode.offsetTop + //<div>text</div> top location
    prevAddressNode.offsetHeight + //text height
    "px";

  prevAddressNode.style.backgroundColor = "white";
  show(donateQr.element);
}

function hideDonateQr() {
  if (prevAddressNode != null) {
    prevAddressNode.style.backgroundColor = "";
  }

  hide(donateQr.element);
}
