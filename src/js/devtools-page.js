/*******************************************************************************

    uBlockVanced - DevTools Page
    Creates the Element Probe panel in Chrome DevTools.
    This panel provides deep element inspection for stubborn CSS elements
    that uBlock's standard picker cannot select (shadow DOM, dynamic classes,
    YouTube live chat banners, etc.)

*******************************************************************************/

chrome.devtools.panels.create(
    'Element Probe',
    'img/icon_16.png',
    'element-probe-panel.html'
);
