var ctCsvHeader = ['Type', 'Buy', 'Cur.', 'Sell', 'Cur.', 'Fee', 'Cur.', 'Exchange', 'Group', 'Comment', 'Date', 'Trade ID'];

var ctField = {
  Type: 0,
  Buy: 1,
  BuyCurrency: 2,
  Sell: 3,
  SellCurrency: 4,
  Fee: 5,
  FeeCurrency: 6,
  Exchange: 7,
  Group: 8,
  Comment: 9,
  Date: 10,
  TxID: 11
};

var ctTransactionType = {
  Deposit: 'Deposit',
  Donation: 'Donation',
  Gift: 'Gift',
  GiftTip: 'Gift/Tip',
  Income: 'Income',
  Lost: 'Lost',
  Mining: 'Mining',
  Stolen: 'Stolen',
  Trade: 'Trade',
  Withdrawal: 'Withdrawal',
  Spend: 'Spend',
  MarginProfit: 'Margin Profit',
  MarginLoss: 'Margin Loss',
};

var fileTypeMatch = new RegExp('^.*Confirmed,Date,Type,Label,Address,Amount.*,ID.*$', 'g');

var csvDialect = {
  csvddfVersion: 1.2,
  delimiter: ',',
  doubleQuote: true,
  lineTerminator: '\r\n',
  quoteChar: '"',
  skipInitialSpace: true,
  header: true
};

var _coinCode = null;
var _walletName = null;
var _ctGroup = null;
var _isCostBasisZero = null;
var _file = {};

$(function () {
  $('#file').val('');
  disableConvert();
  hideDownload();
  setCoinCode('');

  let isHidden = false;
  $('.more-details').click(() => {
    $('.explain').toggle();
    isHidden = !isHidden;
    if (isHidden) {
      $('.more-details').text('hide');
    } else {
      $('.more-details').text('more details');
    }
  });

  $('#file').change(function () {
    disableConvert();
    hideDownload();
    hideError();

    _file = this.files[0];

    let reader = new FileReader();

    reader.onload = function (e) {
      let text = reader.result;

      let firstLine = text.split('\n').shift(); // first line

      firstLine = firstLine.replace(/\r/g, '');
      firstLine = firstLine.replace(/"/g, '');
      //console.log(firstLine);

      if (firstLine.match(fileTypeMatch)) {
        enableConvert();
        let autoDetectCoinCode = firstLine.replace(/^[^(]*\(/, '').replace(/\)[^(]*$/, '');
        if (autoDetectCoinCode == 'PIV'){
          autoDetectCoinCode = 'PIVX';
        }

        setCoinCode(autoDetectCoinCode);
      } else {
        setCoinCode('');
        showError('Wrong file or wallet export format not supported');
      }
    };

    reader.readAsText(_file, 'UTF-8');
  });

  $('#convert').click(function () {
    _coinCode = $('#coinCode')
      .val()
      .toUpperCase();
    _walletName = $('#walletName').val();
    _ctGroup = $('#ctGroup').val();
    _isCostBasisZero = $('#costBasisZero').prop('checked');
    groupByDay = $('#groupMiningByDay').prop('checked');

    if (!validateInput())
      return;

    CSV.fetch({
      file: _file
    }).done(function (dataset) {
      //consoleconsole.log(dataset);
      let csvObject = convert(dataset, groupByDay);
      //console.log(csvObject);
      let csvData = CSV.serialize(csvObject, csvDialect);

      csvData = csvData.substring(0, csvData.length - csvDialect.lineTerminator.length); //remove last line, this is a fix cointracking CSV parser bug. It may introduce a bug if they change to require last empty line
      //console.log(csvData);

      let dateMinMax = getDateMinMax(csvObject);
      showDownload(getFileName(dateMinMax), csvData);
    });
  });
});

function getDateMinMax(csvObject) {
  min = new Date('2199-01-01'); //I won't live longer than 2085 :)
  max = new Date('2000-01-01'); //crypto didn't exists before 2007
  for (let i = 1; i < csvObject.length; i++) {
    let rowDate = csvObject[i][ctField.Date];
    let textDate = rowDate.split(' ')[0];
    let date = new Date(textDate);

    if (min > date) {
      min = date;
    }

    if (max < date) {
      max = date;
    }
  }

  return { min, max };
}

function setCoinCode(coinCode) {
  $('#coinCode').val(coinCode);
}

function convert(dataset, groupByDay) {
  let csvObject = [ctCsvHeader];
  let i;
  let map = new Map();

  for (i = 0; i < dataset.records.length; i++) {
    let row = dataset.records[i];

    if (row[0] == 'false') //skip unconfirmed transactions
      continue;

    convertRow(row, groupByDay, map, csvObject);
  }

  if (groupByDay) {
    addFromMapToCsvObject(map, csvObject);
  }

  return csvObject;
}

function addFromMapToCsvObject(map, csvObject) {
  for (var [key, line] of map) {
    if (line[ctField.TxID] === '') {  //set id only if empty, this means 1+ rows in a day, otherwise keep original TxID since only 1 row that day
      line[ctField.TxID] = getComputedTxId(line.toString(), key);
    }
    csvObject.push(line);
  }
}

function getComputedTxId(str, date) {
  var hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return 'computedID:' + hash + '-' + date;
}

function convertRow(inputRow, groupByDay, map, csvObject) {

  let txType = inputRow[2];

  switch (txType.toLowerCase()) {
    case 'sent to':
      addWithdawalCtLine(inputRow, csvObject);
      break;
    case 'minted': //this could be wrong if minted means going PIV to ZPIV etc., so far didn't have the use case
    case 'mined':
    case 'mining':
    case 'masternode reward':
      addMiningLineOrMap(inputRow, groupByDay, map, csvObject);
      break;
    case 'received with':
      addDeposit(inputRow, csvObject);
      break;
    case 'payment to yourself':
      addPaymentToYourselfLoss(inputRow, csvObject);
      break;
    default:
      if (txType.toLowerCase().includes('stake')) {
        addMiningLineOrMap(inputRow, groupByDay, map, csvObject);
      } else {
        addUnknown(inputRow, csvObject, txType);
      }
      break;
  }
}

function addUnknown(inputRow, csvObject, txType) {
  let ctLine = getBaseCtLine(inputRow);
  ctLine[ctField.Type] = ctTransactionType.Trade;
  ctLine[ctField.Buy] = getAmount(inputRow);
  ctLine[ctField.BuyCurrency] = _coinCode;
  ctLine[ctField.Sell] = getAmount(inputRow);;
  ctLine[ctField.SellCurrency] = _coinCode;
  ctLine[ctField.Comment] = 'Unknown type: ' + txType + ' in export file. Please revise this!';
  csvObject.push(ctLine);
}

function addPaymentToYourselfLoss(inputRow, csvObject) {
  let ctLine = getBaseCtLine(inputRow);
  ctLine[ctField.Type] = ctTransactionType.MarginLoss;
  ctLine[ctField.Sell] = getAmount(inputRow);
  ctLine[ctField.SellCurrency] = _coinCode;
  ctLine[ctField.Comment] = 'Payment to yourself';
  csvObject.push(ctLine);
}

function addDeposit(inputRow, csvObject) {
  let ctLine = getBaseCtLine(inputRow);
  ctLine[ctField.Type] = ctTransactionType.Deposit;
  ctLine[ctField.Buy] = getAmount(inputRow);
  ctLine[ctField.BuyCurrency] = _coinCode;
  ctLine[ctField.TxID] = ctLine[ctField.TxID] + '-1' //CT can't have duplicated TX, this can happen when exchange and wallet report same blockchain TxID 
  csvObject.push(ctLine);
}

function addWithdawalCtLine(inputRow, csvObject) {
  /* Withdrawal TX */
  let ctLine = getBaseCtLine(inputRow);
  let label = inputRow[3];
  ctLine[ctField.Type] = ctTransactionType.Withdrawal;
  ctLine[ctField.Sell] = Math.trunc(getAmount(inputRow));
  ctLine[ctField.SellCurrency] = _coinCode;
  ctLine[ctField.Comment] = `Please verify correct withdrawal less fee! Sent to: ${label}`;
  ctLine[ctField.TxID] = ctLine[ctField.TxID] + '-1' //CT can't have duplicated TX
  csvObject.push(ctLine);

  /* Margin Loss TX to represent the fee and add it to the basis */
  ctLine = getBaseCtLine(inputRow);
  ctLine[ctField.Type] = ctTransactionType.MarginLoss;
  ctLine[ctField.Sell] = getDecimalPart(getAmount(inputRow));
  ctLine[ctField.SellCurrency] = _coinCode;
  ctLine[ctField.Comment] = `Please verify fee only when Sent to: ${label}`;
  ctLine[ctField.TxID] = ctLine[ctField.TxID] + '-2' //CT can't have duplicated TX
  csvObject.push(ctLine);
}

function getBaseCtLine(inputRow) {
  let ctLine = getEmptyLine();
  ctLine[ctField.Exchange] = _walletName;
  ctLine[ctField.Date] = inputRow[1].replace('T', ' ');
  ctLine[ctField.TxID] = inputRow[6];
  ctLine[ctField.Group] = _ctGroup;
  return ctLine;
}

function getAmount(inputRow) {
  return eval(inputRow[5].replace('-', ''));
}

function getEmptyLine() {
  return ['', '', '', '', '', '', '', '', '', '', '', ''];
}

function fpFix(n) {
  return Math.round(n * 100000000) / 100000000;
}

function getDecimalPart(decNum) {
  return Math.round((decNum % 1) * 100000000) / 100000000;
}

function addMiningLineOrMap(inputRow, groupByDay, map, csvObject) {
  let ctLine = getBaseCtLine(inputRow);
  let amount = getAmount(inputRow);
  let date = ctLine[ctField.Date].split(' ')[0];

  ctLine[ctField.Buy] = amount;
  ctLine[ctField.BuyCurrency] = _coinCode;
  ctLine[ctField.Type] = ctTransactionType.Mining;

  if (_isCostBasisZero) { //this pice of code could be changed now into Margin Profit
    ctLine[ctField.Type] = ctTransactionType.MarginProfit;
  }

  if (groupByDay) {
    if (map.has(date)) {
      ctLine = map.get(date);
      ctLine[ctField.Date] = date + ' 23:59:59'; //this will ovveride only if more that 1 mint a day, otherwise we keep original date for single mint
      ctLine[ctField.TxID] = ''; //reset ID to assure same hash in case of a shift in row processing
      ctLine[ctField.Buy] = fpFix(ctLine[ctField.Buy] + amount);
    };
    map.set(date, ctLine);
  }
  else {
    csvObject.push(ctLine);
  }
}

function getFileName(dateMinMax) {
  let minDate = dateMinMax.min.toISOString().split('T')[0];
  let maxDate = dateMinMax.max.toISOString().split('T')[0];

  let fullName = _walletName + '-' + _coinCode + '-to-cointracking-' + minDate + '--' + maxDate + '.csv';
  return fullName.toLowerCase();
}

function validateInput() {
  if (_coinCode.length == 0) {
    showError('Coin Code is required!');
    return false;
  }
  if (_walletName.length == 0) {
    showError('Wallet Name is required!');
    return false;
  }
  hideError();
  return true;
}

function hideDownload() {
  $('#download').hide();
  $('#downloadFileName').hide();
}

function showDownload(fileName, data) {
  $('#download').attr('href', 'data:text/csv;base64,' + btoa(data));
  $('#download').attr('download', fileName);
  $('#download').show();
  $('#downloadFileName').text(fileName);
  $('#downloadFileName').show();
}

function enableConvert() {
  $('#convert').prop('disabled', false);
}

function disableConvert() {
  $('#convert').prop('disabled', true);
}

function hideError() {
  $('#error').text('');
  $('#error').hide();
}

function showError(text) {
  $('#error').show();
  $('#error').text(text);
}

function showPage(obj) {
  $('[id^="page-"]').hide();
  $('#page-' + obj.id).show();
}
