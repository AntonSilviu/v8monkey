/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const CC = Components.Constructor;

const LocalFile = CC('@mozilla.org/file/local;1',
                     'nsILocalFile',
                     'initWithPath');

Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.import('resource://gre/modules/Services.jsm');

XPCOMUtils.defineLazyGetter(Services, 'env', function() {
  return Cc['@mozilla.org/process/environment;1']
           .getService(Ci.nsIEnvironment);
});

XPCOMUtils.defineLazyGetter(Services, 'ss', function() {
  return Cc['@mozilla.org/content/style-sheet-service;1']
           .getService(Ci.nsIStyleSheetService);
});
XPCOMUtils.defineLazyGetter(Services, 'idle', function() {
  return Cc['@mozilla.org/widget/idleservice;1']
           .getService(Ci.nsIIdleService);
});

// In order to use http:// scheme instead of file:// scheme
// (that is much more restricted) the following code kick-off
// a local http server listening on http://127.0.0.1:7777 and
// http://localhost:7777.
function startupHttpd(baseDir, port) {
  const httpdURL = 'chrome://browser/content/httpd.js';
  let httpd = {};
  Services.scriptloader.loadSubScript(httpdURL, httpd);
  let server = new httpd.nsHttpServer();
  server.registerDirectory('/', new LocalFile(baseDir));
  server.registerContentType('appcache', 'text/cache-manifest');
  server.start(port);
}

// FIXME Bug 707625
// until we have a proper security model, add some rights to
// the pre-installed web applications
// XXX never grant 'content-camera' to non-gaia apps
function addPermissions(urls) {
  let permissions = [
    'indexedDB', 'indexedDB-unlimited', 'webapps-manage', 'offline-app', 'content-camera'
  ];
  urls.forEach(function(url) {
    let uri = Services.io.newURI(url, null, null);
    let allow = Ci.nsIPermissionManager.ALLOW_ACTION;

    permissions.forEach(function(permission) {
      Services.perms.add(uri, permission, allow);
    });
  });
}


var shell = {
  // FIXME/bug 678695: this should be a system setting
  preferredScreenBrightness: 1.0,
  
  isDebug: false,

  get contentBrowser() {
    delete this.contentBrowser;
    return this.contentBrowser = document.getElementById('homescreen');
  },

  get homeURL() {
    try {
      let homeSrc = Services.env.get('B2G_HOMESCREEN');
      if (homeSrc)
        return homeSrc;
    } catch (e) {}

    let urls = Services.prefs.getCharPref('browser.homescreenURL').split(',');
    for (let i = 0; i < urls.length; i++) {
      let url = urls[i];
      if (url.substring(0, 7) != 'file://')
        return url;

      let file = new LocalFile(url.substring(7, url.length));
      if (file.exists())
        return url;
    }
    return null;
  },

  start: function shell_init() {
    let homeURL = this.homeURL;
    if (!homeURL) {
      let msg = 'Fatal error during startup: [No homescreen found]';
      return alert(msg);
    }

    window.controllers.appendController(this);
    window.addEventListener('keypress', this);
    window.addEventListener('MozApplicationManifest', this);
    window.addEventListener("AppCommand", this);
    this.contentBrowser.addEventListener('load', this, true);

    try {
      Services.io.offline = false;

      let fileScheme = 'file://';
      if (homeURL.substring(0, fileScheme.length) == fileScheme) {
        homeURL = homeURL.replace(fileScheme, '');

        let baseDir = homeURL.split('/');
        baseDir.pop();
        baseDir = baseDir.join('/');

        const SERVER_PORT = 6666;
        startupHttpd(baseDir, SERVER_PORT);

        let baseHost = 'http://localhost';
        homeURL = homeURL.replace(baseDir, baseHost + ':' + SERVER_PORT);
      }
      addPermissions([homeURL]);
    } catch (e) {
      let msg = 'Fatal error during startup: [' + e + '[' + homeURL + ']';
      return alert(msg);
    }

    // Load webapi+apps.js as a frame script
    let frameScriptUrl = 'chrome://browser/content/webapi.js';
    try {
      messageManager.loadFrameScript(frameScriptUrl, true);
    } catch (e) {
      dump('Error when loading ' + frameScriptUrl + ' as a frame script: ' + e + '\n');
    }

    let browser = this.contentBrowser;
    browser.homePage = homeURL;
    browser.goHome();
  },

  stop: function shell_stop() {
    window.controllers.removeController(this);
    window.removeEventListener('keypress', this);
    window.removeEventListener('MozApplicationManifest', this);
    window.removeEventListener('AppCommand', this);
  },

  supportsCommand: function shell_supportsCommand(cmd) {
    let isSupported = false;
    switch (cmd) {
      case 'cmd_close':
        isSupported = true;
        break;
      default:
        isSupported = false;
        break;
    }
    return isSupported;
  },

  isCommandEnabled: function shell_isCommandEnabled(cmd) {
    return true;
  },

  doCommand: function shell_doCommand(cmd) {
    switch (cmd) {
      case 'cmd_close':
        content.postMessage('appclose', '*');
        break;
    }
  },

  toggleDebug: function shell_toggleDebug() {
    this.isDebug = !this.isDebug;

    if (this.isDebug) {
      Services.prefs.setBoolPref("layers.acceleration.draw-fps", true);
      Services.prefs.setBoolPref("nglayout.debug.paint_flashing", true);
    } else {
      Services.prefs.setBoolPref("layers.acceleration.draw-fps", false);
      Services.prefs.setBoolPref("nglayout.debug.paint_flashing", false);
    }
  },

  handleEvent: function shell_handleEvent(evt) {
    switch (evt.type) {
      case 'keypress':
        switch (evt.keyCode) {
          case evt.DOM_VK_HOME:
            this.sendEvent(content, 'home');
            break;
          case evt.DOM_VK_SLEEP:
            this.toggleScreen();

            let details = {
              'enabled': screen.mozEnabled
            };
            this.sendEvent(content, 'sleep', details);
            break;
          case evt.DOM_VK_ESCAPE:
            if (evt.defaultPrevented)
              return;
            this.doCommand('cmd_close');
            break;
        }
        break;
      case 'AppCommand':
        switch (evt.command) {
          case 'Menu':
            this.sendEvent(content, 'menu');
            break;
          case 'Search':
            this.toggleDebug();
            break;
        }
        break;
      case 'load':
        this.contentBrowser.removeEventListener('load', this, true);
        this.turnScreenOn();

        let chromeWindow = window.QueryInterface(Ci.nsIDOMChromeWindow);
        chromeWindow.browserDOMWindow = new nsBrowserAccess();

        this.sendEvent(window, 'ContentStart');
        break;
      case 'MozApplicationManifest':
        try {
          if (!Services.prefs.getBoolPref('browser.cache.offline.enable'))
            return;

          let contentWindow = evt.originalTarget.defaultView;
          let documentElement = contentWindow.document.documentElement;
          if (!documentElement)
            return;

          let manifest = documentElement.getAttribute('manifest');
          if (!manifest)
            return;

          let documentURI = contentWindow.document.documentURIObject;
          if (!Services.perms.testPermission(documentURI, 'offline-app')) {
            if (Services.prefs.getBoolPref('browser.offline-apps.notify')) {
              // FIXME Bug 710729 - Add a UI for offline cache notifications
              return;
            }
            return;
          }

          Services.perms.add(documentURI, 'offline-app',
                             Ci.nsIPermissionManager.ALLOW_ACTION);

          let manifestURI = Services.io.newURI(manifest, null, documentURI);
          let updateService = Cc['@mozilla.org/offlinecacheupdate-service;1']
                              .getService(Ci.nsIOfflineCacheUpdateService);
          updateService.scheduleUpdate(manifestURI, documentURI, window);
        } catch (e) {
          dump('Error while creating offline cache: ' + e + '\n');
        }
        break;
    }
  },
  sendEvent: function shell_sendEvent(content, type, details) {
    let event = content.document.createEvent('CustomEvent');
    event.initCustomEvent(type, true, true, details ? details : {});
    content.dispatchEvent(event);
  },
  toggleScreen: function shell_toggleScreen() {
    if (screen.mozEnabled)
      this.turnScreenOff();
    else
      this.turnScreenOn();
  },
  turnScreenOff: function shell_turnScreenOff() {
    screen.mozEnabled = false;
    screen.mozBrightness = 0.0;
  },
  turnScreenOn: function shell_turnScreenOn() {
    screen.mozEnabled = true;
    screen.mozBrightness = this.preferredScreenBrightness;
  }
};

(function PowerManager() {
  let idleHandler = {
    observe: function(subject, topic, time) {
      if (topic === "idle") {
        // TODO: Check wakelock status. See bug 697132.
        shell.turnScreenOff();
      }
    },
  }
  let idleTimeout = Services.prefs.getIntPref("power.screen.timeout");
  if (idleTimeout) {
    Services.idle.addIdleObserver(idleHandler, idleTimeout);
  }
})();

function nsBrowserAccess() {
}

nsBrowserAccess.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIBrowserDOMWindow]),

  openURI: function openURI(uri, opener, where, context) {
    // TODO This should be replaced by an 'open-browser-window' intent
    let contentWindow = content.wrappedJSObject;
    if (!('getApplicationManager' in contentWindow))
      return null;

    let applicationManager = contentWindow.getApplicationManager();
    if (!applicationManager)
      return null;

    let url = uri ? uri.spec : 'about:blank';
    let window = applicationManager.launch(url, where);
    return window.contentWindow;
  },

  openURIInFrame: function openURIInFrame(uri, opener, where, context) {
    throw new Error('Not Implemented');
  },

  isTabContentWindow: function isTabContentWindow(contentWindow) {
    return contentWindow == window;
  }
};

// Pipe `console` log messages to the nsIConsoleService which writes them
// to logcat.
Services.obs.addObserver(function onConsoleAPILogEvent(subject, topic, data) {
  let message = subject.wrappedJSObject;
  let prefix = "Content JS " + message.level.toUpperCase() +
               " at " + message.filename + ":" + message.lineNumber +
               " in " + (message.functionName || "anonymous") + ": ";
  Services.console.logStringMessage(prefix + Array.join(message.arguments, " "));
}, "console-api-log-event", false);
