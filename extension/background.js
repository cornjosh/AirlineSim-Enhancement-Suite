// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';
//Functions
function setDefaultSettings() {
    //Add default settings

    let aesSettings = {
        invPricing: setDefaultInvPricingSettings(),
        general: setDefaultGeneralSettings(),
        schedule: setDefaultScheduleSettings(),
        flightInfo: setDefaultFlightInfoSettings()
    };
    chrome.storage.local.get(['settings'], function(result) {
        let settings = result.settings;
        if (!settings) {
            settings = aesSettings;
            chrome.storage.local.set({ settings: aesSettings }, function() {

            });
        }
    });
    //
}

function setDefaultScheduleSettings() {
    //auto settings
    let schedule = {
        autoExtract: 0
    };
    //Cmp settings
    return schedule;
}

function setDefaultGeneralSettings() {
    //auto settings
    let general = {
        defaultDashboard: 'general'
    };
    //Cmp settings
    return general;
}

function setDefaultInvPricingSettings() {
    //auto settings
    let invPricing = {
        autoAnalysisSave: 1,
        autoPriceUpdate: 0,
        autoClose: 0,
        recommendation: {},
        historyTable: {
            showNow: 1,
            showOnlyPricing: 0,
            numberOfDates: "5"
        }
    };
    //Cmp settings
    let steps = [
        {
            min: 0,
            max: 40,
            name: 'Drop High',
            step: -8
    },
        {
            min: 40,
            max: 60,
            name: 'Drop Medium',
            step: -4
    },
        {
            min: 60,
            max: 70,
            name: 'Drop Low',
            step: -2
    },
        {
            min: 70,
            max: 80,
            name: 'Keep',
            step: 0
    },
        {
            min: 80,
            max: 90,
            name: 'Raise Low',
            step: 1
    },
        {
            min: 90,
            max: 99,
            name: 'Raise Medium',
            step: 2
    },
        {
            min: 99,
            max: 100,
            name: 'Raise High',
            step: 5
    }
  ];
    let cmps = ['Y', 'C', 'F', 'Cargo'];
    cmps.forEach(function(cmp) {
        invPricing.recommendation[cmp] = {
            maxPrice: 200,
            minPrice: 60,
            steps: steps
        };
    });
    return invPricing;
}

function setDefaultFlightInfoSettings() {
    //auto settings
    let flightInfo = {
        autoClose: 0,
        autoExtractOnOpenAircraft: 0,
        autoExtractScope: 'finished',
        autoCloseAircraftAfterRefresh: 1
    };
    return flightInfo;
}

//MAIN
chrome.runtime.onInstalled.addListener(function() {
    setDefaultSettings();
    chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
        chrome.declarativeContent.onPageChanged.addRules([{
            conditions: [new chrome.declarativeContent.PageStateMatcher({
                pageUrl: { hostContains: '.airlinesim.aero' },
            })],
            actions: [new chrome.declarativeContent.ShowPageAction()]
    }]);
    });
});

// Sequential Aircraft Processing Queue
let aircraftQueue = [];
let isProcessing = false;
let currentTabId = null;
let timeoutHandle = null;

// Constants
const perAircraftTimeoutMs = 30 * 1000; // 30 seconds
const openNextDelayMs = 10 * 1000; // 10 seconds

// Message handler
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'startSequentialAircraftProcessing') {
        console.log('AES Background: Received aircraft URLs to process:', message.urls);
        
        // Add URLs to queue
        aircraftQueue.push(...message.urls);
        
        // Start processing if not already running
        if (!isProcessing) {
            processNext();
        }
        
        sendResponse({ success: true, queued: message.urls.length });
        return true;
    }
});

// Tab removed handler
chrome.tabs.onRemoved.addListener(function(tabId) {
    if (tabId === currentTabId) {
        console.log('AES Background: Current aircraft tab closed:', tabId);
        currentTabId = null;
        
        // Clear timeout if active
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
        
        // Schedule next processing after delay
        setTimeout(function() {
            processNext();
        }, openNextDelayMs);
    }
});

function processNext() {
    if (aircraftQueue.length === 0) {
        console.log('AES Background: Queue empty, processing complete');
        isProcessing = false;
        return;
    }
    
    isProcessing = true;
    const nextUrl = aircraftQueue.shift();
    
    console.log('AES Background: Opening next aircraft:', nextUrl);
    console.log('AES Background: Remaining in queue:', aircraftQueue.length);
    
    // Create inactive tab
    chrome.tabs.create({
        url: nextUrl,
        active: false
    }, function(tab) {
        currentTabId = tab.id;
        
        // Set timeout for this aircraft
        timeoutHandle = setTimeout(function() {
            console.log('AES Background: Aircraft timeout reached, force closing tab:', currentTabId);
            
            if (currentTabId) {
                chrome.tabs.remove(currentTabId, function() {
                    // Tab removal will trigger onRemoved handler
                });
            }
        }, perAircraftTimeoutMs);
    });
}
