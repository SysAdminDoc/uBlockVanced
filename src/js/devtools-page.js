/*******************************************************************************

    uBlockForge - DevTools Page
    Creates the Element Forge panel in Chrome DevTools.
    This panel provides deep element inspection for stubborn CSS elements
    that uBlock's standard picker cannot select (shadow DOM, dynamic classes,
    YouTube live chat banners, etc.)

*******************************************************************************/

chrome.devtools.panels.create(
    'Element Forge',
    'img/icon_16.png',
    'element-forge-panel.html'
);
