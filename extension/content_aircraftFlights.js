"use strict";
//MAIN
//Global vars
var aircraftFlightData;
var settings;
var autoExtractionInProgress = false;
var autoCloseTimeout;

$(function() {
    aircraftFlightData = getData();
    
    // Load settings first, then handle auto-extraction if needed
    chrome.storage.local.get(['settings'], function(result) {
        settings = result.settings;
        
        // Check for auto-extraction URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const aesParam = urlParams.get('aes');
        
        if (aesParam && aesParam.startsWith('auto-extract-')) {
            const scope = aesParam.replace('auto-extract-', '');
            handleAutoExtraction(scope);
        } else {
            // Normal flow - just get storage data
            getStorageData();
        }
    });
    
    // Check if we're returning from an auto-refresh
    if (sessionStorage.getItem('aes-auto-refresh-pending')) {
        sessionStorage.removeItem('aes-auto-refresh-pending');
        handleAutoRefreshReturn();
    }
});

function handleAutoExtraction(scope) {
    console.log('AES: Auto-extraction triggered with scope:', scope);
    autoExtractionInProgress = true;
    
    // Get storage data first
    getStorageData();
    
    // Trigger auto-extraction after a short delay to ensure DOM is ready
    setTimeout(function() {
        if (scope === 'finished' || scope === 'all') {
            console.log('AES: Starting auto-extraction for scope:', scope);
            autoExtractAndMonitor(scope);
        } else {
            console.warn('AES: Unknown extraction scope:', scope);
            autoExtractionInProgress = false;
        }
    }, 1000);
}

async function autoExtractAndMonitor(scope) {
    // Start extraction
    await extractAllFlightProfit(scope);
    
    // Monitor for completion
    monitorExtractionCompletion(scope);
}

function monitorExtractionCompletion(scope) {
    const targetFlights = getTargetFlights(scope);
    const totalFlights = targetFlights.length;
    
    if (totalFlights === 0) {
        console.log('AES: No flights to extract');
        handleExtractionComplete();
        return;
    }
    
    console.log('AES: Monitoring extraction progress for', totalFlights, 'flights');
    
    let checkCount = 0;
    const maxChecks = 300; // 30 seconds with 100ms intervals
    
    const monitor = setInterval(function() {
        checkCount++;
        
        // Get current storage data
        let keys = [];
        for (let flight of targetFlights) {
            let key = aircraftFlightData.server + 'flightInfo' + flight.id;
            keys.push(key);
        }
        
        chrome.storage.local.get(keys, function(result) {
            let extractedCount = 0;
            
            for (let key in result) {
                if (result[key] && result[key].flightId) {
                    extractedCount++;
                }
            }
            
            console.log('AES: Extraction progress:', extractedCount, '/', totalFlights);
            
            if (extractedCount >= totalFlights || checkCount >= maxChecks) {
                clearInterval(monitor);
                
                if (extractedCount >= totalFlights) {
                    console.log('AES: Extraction completed successfully');
                } else {
                    console.log('AES: Extraction timed out, proceeding anyway');
                }
                
                handleExtractionComplete();
            }
        });
    }, 100);
}

function getTargetFlights(scope) {
    return aircraftFlightData.flights.filter(function(flight) {
        if (scope === 'finished') {
            return flight.status === 'finished' || flight.status === 'inflight';
        } else if (scope === 'all') {
            return true;
        }
        return false;
    });
}

function handleExtractionComplete() {
    autoExtractionInProgress = false;
    
    if (settings.flightInfo && settings.flightInfo.autoCloseAircraftAfterRefresh) {
        console.log('AES: Auto-refresh and close enabled, refreshing page...');
        
        // Set sessionStorage flag to indicate we're auto-refreshing
        sessionStorage.setItem('aes-auto-refresh-pending', 'true');
        
        // Refresh the page to save aggregated data
        window.location.reload();
    } else {
        console.log('AES: Auto-refresh disabled, extraction complete');
    }
}

function handleAutoRefreshReturn() {
    console.log('AES: Returned from auto-refresh, waiting for data save...');
    
    // Wait for the aggregated data to be saved
    const aircraftKey = aircraftFlightData.server + aircraftFlightData.type + aircraftFlightData.aircraftId;
    
    // Monitor for the storage save completion
    let checkCount = 0;
    const maxChecks = 300; // 30 seconds
    
    const monitor = setInterval(function() {
        checkCount++;
        
        chrome.storage.local.get([aircraftKey], function(result) {
            if (result[aircraftKey] || checkCount >= maxChecks) {
                clearInterval(monitor);
                
                if (result[aircraftKey]) {
                    console.log('AES: Aggregated data saved, closing tab...');
                } else {
                    console.log('AES: Timeout waiting for data save, closing tab anyway...');
                }
                
                // Set a fallback timeout
                autoCloseTimeout = setTimeout(function() {
                    console.log('AES: Fallback timeout, closing tab...');
                    window.close();
                }, 1000);
                
                // Close the tab
                window.close();
            }
        });
    }, 100);
    
    // Fallback timeout to prevent hanging
    setTimeout(function() {
        if (monitor) {
            clearInterval(monitor);
            console.log('AES: Fallback timeout reached, closing tab...');
            window.close();
        }
    }, 30000);
}

function getStorageData() {
    let keys = [];
    for (let i = 0; i < aircraftFlightData.flights.length; i++) {
        let key = aircraftFlightData.server + 'flightInfo' + aircraftFlightData.flights[i].id;
        keys.push(key);
    }
    chrome.storage.local.get(keys, function(result) {
        for (let flightInfo in result) {
            for (let i = 0; i < aircraftFlightData.flights.length; i++) {
                if (aircraftFlightData.flights[i].id == result[flightInfo].flightId) {
                    aircraftFlightData.flights[i].data = result[flightInfo];
                }
            }
        }

        //Async
        getTotalProfit();
    });
}

function getTotalProfit() {
    let profit = 0;
    let profitFlights = 0;
    aircraftFlightData.flights.forEach(function(value) {
        if (value.status == 'finished' || value.status == 'inflight') {
            if (value.data) {
                profit += value.data.money.CM5.Total;
                profitFlights++;
            }
        }
    });
    aircraftFlightData.profit = profit;
    aircraftFlightData.profitFlights = profitFlights;
    //Async
    saveData();
}

function saveData() {
    let key = aircraftFlightData.server + aircraftFlightData.type + aircraftFlightData.aircraftId;
    let saveData = {
        aircraftId: aircraftFlightData.aircraftId,
        date: aircraftFlightData.date,
        equipment: aircraftFlightData.equipment,
        finishedFlights: aircraftFlightData.finishedFlights,
        profit: aircraftFlightData.profit,
        profitFlights: aircraftFlightData.profitFlights,
        registration: aircraftFlightData.registration,
        server: aircraftFlightData.server,
        time: aircraftFlightData.time,
        totalFlights: aircraftFlightData.totalFlights,
        type: aircraftFlightData.type,
    }
    chrome.storage.local.set({
        [key]: saveData }, function() {
        display();
    });
}

function display() {
    displayFlightProfit();
    //Table
    let tableWell = $('<div class="as-table-well" style="max-width:950px;"></div>').append(buildTable());
    let panel = $('<div class="as-panel"></div>').append(tableWell);
    //action bar
    let btn = $('<button class="btn btn-default"></button>').text('Extract all flight profit/loss');
    let btn1 = $('<button class="btn btn-default"></button>').text('Extract finished flight profit/loss');

    let span = $('<span></span>');
    let li = $('<li></li>').append(btn1, btn, span);
    let actionBar = $('<ul class="as-panel as-action-bar"></ul>').append(li);
    //btn click
    btn.click(function() {
        btn.hide();
        btn1.hide();
        span.addClass('warning').text('Please reload page after all flight info pages open');
        extractAllFlightProfit('all');
    });
    btn1.click(function() {
        btn.hide();
        btn1.hide();
        span.addClass('warning').text('Please reload page after all flight info pages open');
        extractAllFlightProfit('finished');
    })
    
    // Check for auto-extract query parameter and trigger automatically
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('aes') === 'auto-extract-finished') {
        // Use setTimeout to ensure UI is ready
        setTimeout(function() {
            btn1.click();
        }, 500);
    }
    
    //Header
    let h = $('<h3></h3>').text('AES Aircraft Flights');
    let div = $('<div></div>').append(h, actionBar, panel);
    $('.as-page-aircraft > h1:eq(0)').after(div);
}

async function extractAllFlightProfit(type) {
    for (const value of aircraftFlightData.flights) {
        if (type === 'finished') {
            if (value.status !== 'finished' && value.status !== 'inflight') {
                continue;
            }
        }
        const url = 'https://' + aircraftFlightData.server + '.airlinesim.aero/action/info/flight?id=' + value.id;
        window.open(url, '_blank');
        await AES.sleep(100);  // Interval 100ms
    }
}

function displayFlightProfit() {
    //Table
    let table = $('#aircraft-flight-instances-table');
    //Head
    let th = ['<th>Profit/Loss</th>', '<th>Extract date</th>'];
    $('th:eq(9)', table).after(th);
    //body
    aircraftFlightData.flights.forEach(function(value) {
        let td = [];

        if (value.data) {
            td.push(formatMoney(value.data.money.CM5.Total));
            td.push($('<td></td>').text(AES.formatDateString(value.data.date) + ' ' + value.data.time));
        } else {
            td.push('<td class="text-center">--</td>');
            td.push('<td class="text-center">--</td>');
        }

        $('td:eq(11)', value.row).after(td);
    });
    $("tfoot td", table).attr("colspan", "15")
}

function buildTable() {
    //head
    let row = [];
    row.push($('<tr></tr>').append('<th>Total aircraft profit/loss</th>', formatMoney(aircraftFlightData.profit)));
    row.push($('<tr></tr>').append('<th>Aircraft Id</th>', '<td>' + aircraftFlightData.aircraftId + '</td>'));
    row.push($('<tr></tr>').append('<th>Registration</th>', '<td>' + aircraftFlightData.registration + '</td>'));
    row.push($('<tr></tr>').append('<th>Total flights</th>', '<td>' + aircraftFlightData.totalFlights + '</td>'));
    row.push($('<tr></tr>').append('<th>Finished flights</th>', '<td>' + aircraftFlightData.finishedFlights + '</td>'));
    row.push($('<tr></tr>').append('<th>Finished flights with profit/loss extract</th>', '<td>' + aircraftFlightData.profitFlights + '</td>'));
    row.push($('<tr></tr>').append('<th>Data save time</th>', '<td>' + AES.formatDateString(aircraftFlightData.date) + ' ' + aircraftFlightData.time + '</td>'));

    let tbody = $('<tbody></tbody>').append(row);
    return $('<table class="table table-bordered table-striped table-hover"></table>').append(tbody);
}

function getData() {
    //Aircraft ID
    let aircraftId = getAircraftId();
    let aircraftInfo = getAircraftInfo();
    let date = AES.getServerDate()
    let server = AES.getServerName();
    let flights = getFlights();
    let flightsStats = getFlightsStats(flights);
    return {
        server: server,
        aircraftId: aircraftId,
        type: 'aircraftFlights',
        date: date.date,
        time: date.time,
        registration: aircraftInfo.registration,
        equipment: aircraftInfo.equipment,
        flights: flights,
        finishedFlights: flightsStats.finishedFlights,
        totalFlights: flightsStats.totalFlights
    }
}

function getFlightsStats(flights) {
    let finished, total;
    finished = total = 0;
    flights.forEach(function(value) {
        if (value.status == 'finished' || value.status == 'inflight') {
            finished++;
        }
        total++;
    });
    return {
        totalFlights: total,
        finishedFlights: finished
    }
}

/**
 * Get the data from “flights” table
 * @returns {array} flights
 */
function getFlights() {
    const table = document.querySelector("#aircraft-flight-instances-table")
    const rows = table.querySelectorAll("tbody tr")
    const flights = []

    for (const row of rows) {
        const flight = {
            status: null,
            id: null,
            row: null
        }
        const flightNumber = row.querySelector("td:nth-child(2)")?.innerText.trim()
        if (flightNumber === "XFER" || flightNumber === undefined) {
            continue
        }
        const url = row.querySelector(`[href*="action/info/flight"]`)?.href
        if (!url) {
            throw new Error("getFlights(): no valid value for `url`")
            continue
        }

        flight.status = row.querySelector(".flightStatusPanel")?.innerText.trim()
        flight.id = parseInt(url.match(/id=(\d+)/)[1], 10)
        flight.row = $(row)
        flights.push(flight)
    }

    return flights
}

function getAircraftInfo() {
    let span = $('h1 span');
    return {
        registration: $(span[0]).text().trim(),
        equipment: $(span[1]).text().trim()
    }
}

function getAircraftId() {
    let url = window.location.pathname;
    let a = url.split('/');
    return parseInt(a[a.length - 2], 10);
}

function formatMoney(value) {
    let container = document.createElement("td")
    let formattedValue = Intl.NumberFormat().format(value)
    let indicatorEl = document.createElement("span")
    let valueEl = document.createElement("span")
    let currencyEl = document.createElement("span")

    if (value >= 0) {
        valueEl.classList.add("good")
        indicatorEl.innerText = "+"
    }

    if (value < 0) {
        valueEl.classList.add("bad")
        indicatorEl.innerText = "-"
        formattedValue = formattedValue.replace("-", "")
    }

    valueEl.innerText = formattedValue
    currencyEl.innerText = " AS$"

    container.classList.add("aes-text-right", "aes-no-text-wrap")
    container.append(indicatorEl, valueEl, currencyEl)

    return container
}
