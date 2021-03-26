// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IDevToolsWindow } from "../host";
import ToolsHost from "../toolsHost";

declare let InspectorFrontendHost: ToolsHost;

interface IRevealable {
    lineNumber: number;
    columnNumber: number;
    uiSourceCode: {
        _url: string;
    };
}

const enum KeepMatchedText {
    InFront = 1,
    AtEnd = 2
}

const isDrawerEnabled = "(Root.Runtime.vscodeSettings.enableNetwork || Root.Runtime.vscodeSettings.whatsNew)";

function replaceInSourceCode(content: string, pattern: RegExp, replacementText: string, keepMatchedText?: KeepMatchedText) {
    const match = content.match(pattern);
    if (match) {
        if (keepMatchedText) {
            const matchedText = match[0];
            if (keepMatchedText === KeepMatchedText.AtEnd) {
                replacementText = `${replacementText}${matchedText}`;
            } else {
                replacementText = `${matchedText}${replacementText}`;
            }
        }
        return content.replace(pattern, replacementText);
    } else {
        return null;
    }
}

export function revealInVSCode(revealable: IRevealable | undefined, omitFocus: boolean) {
    if (revealable && revealable.uiSourceCode && revealable.uiSourceCode._url) {
        // using Devtools legacy mode.
        (self as any as IDevToolsWindow).InspectorFrontendHost.openInEditor(
            revealable.uiSourceCode._url,
            revealable.lineNumber,
            revealable.columnNumber,
            omitFocus,
        );
    }

    return Promise.resolve();
}

export function getVscodeSettings(callback: (arg0: object) => void) {
    InspectorFrontendHost.getVscodeSettings(callback);
}

export function sendToVscodeOutput(message: string) {
    // Since we are calling InspectorFrontendHost outside of root.js, we need to use InspectorFrontendHost.InspectorFrontendHostInstance
    InspectorFrontendHost.InspectorFrontendHostInstance.sendToVscodeOutput(message);
}

export function applyExtensionSettingsInstantiatePatch(content: string) {
    const pattern = /const experiments\s*=\s*new ExperimentsSupport\(\);/;
    const replacementText = `const vscodeSettings={};`
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.AtEnd);
}

export function applyExtensionSettingsRuntimeObjectPatch(content: string){
    const pattern = /experiments:\s*experiments/;
    const replacementText = ', vscodeSettings:vscodeSettings';
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}

export function applyCreateExtensionSettingsLegacyPatch(content: string) {
    const pattern = /Root\.Runtime\.experiments/g;
    const replacementText = 'Root.Runtime.vscodeSettings = Runtime.vscodeSettings;';
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.AtEnd);
}

export function applyPortSettingsFunctionCreationPatch(content: string) {
    const pattern = /static instance/g;
    const replacementText = getVscodeSettings.toString().slice(9);
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.AtEnd);
}

export function applyPortSettingsFunctionCallPatch(content: string) {
    const pattern = /this._descriptorsMap\s*=\s*{};/g;
    const replacementText = 'this.getVscodeSettings((vscodeSettingsObject) => {Object.assign(vscodeSettings, vscodeSettingsObject);});';
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}

export function applyCommonRevealerPatch(content: string) {
    const pattern = /let reveal\s*=\s*function\s*\(revealable,\s*omitFocus\)\s*{/g;
    const replacementText = `let reveal = ${revealInVSCode.toString().slice(0, -1)}`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyStylesRevealerPatch(content: string) {
    const pattern = /this\._navigateToSource\(selectElement,\s*true\);/g;
    const replacementText = '';
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyQuickOpenPatch(content: string) {
    // This patch removes the ability to use the quick open menu (CTRL + P)
    const pattern = /handleAction\(context,\s*actionId\)\s*{\s*switch\s*\(actionId\)/;
    const replacementText = "handleAction(context, actionId) { actionId = null; switch(actionId)";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyCommandMenuPatch(content: string) {
    // pattern intended to match logic of CommandMenu.attach()
    const pattern = /for\s*\(const action of actions\)\s*{\s*const category\s*=\s*action[\s\S]+this\._commands\.sort\(commandComparator\);/;
    const replacementText =
        `const networkEnabled = Root.Runtime.vscodeSettings.enableNetwork;
        for (const action of actions) {
        const category = action.category();
        if (!category) {
            continue;
        }
        let condition = (category !== 'Elements' || action.title() === 'Show DOM Breakpoints');
        if (networkEnabled) {
            condition = condition && category !== 'Network';
        }
        if (!condition) {
            const options = {action, userActionCode: undefined};
            this._commands.push(CommandMenu.createActionCommand(options));
        }
        }
        for (const command of allCommands) {
        let condition = (command.category() !== 'Elements' || command.title() === 'Show DOM Breakpoints');
        if (networkEnabled) {
            condition = condition && command.category() !== 'Network';
        }
        if (!condition && command.available()) {
            this._commands.push(command);
        }
        }
        this._commands = this._commands.sort(commandComparator);`
    return replaceInSourceCode(content, pattern, replacementText);
}

// This function is needed for Elements-only version, but we need the drawer
// for the Request Blocking tool when enabling the Network Panel.
export function applyInspectorViewShowDrawerPatch(content: string) {
    // This patch hides the drawer.
    const pattern = /_showDrawer\(focus\)\s*{/g;
    const replacementText = `_showDrawer(focus) { if (!${isDrawerEnabled}) {return false;}`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorViewCloseDrawerPatch(content: string) {
    // this patch closes the drawer if the network tool is disabled
    const pattern = /InspectorView\.InspectorView\.instance\(\)\.createToolbars\(\);/g;
    const replacementText = `if (!${isDrawerEnabled}) {InspectorView.InspectorView.instance()._closeDrawer();}`;
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}

export function applyMainViewPatch(content: string) {
    const pattern = /const moreTools\s*=\s*[^;]+;/g;
    const replacementText = "const moreTools = { defaultSection: () => ({ appendItem: () => {} }) };";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyScreencastAppPatch(content: string) {
    // This patch fixes screencasting functionality in version 88
    const pattern = /this\._getAppProviderInstance\('Main.SimpleAppProvider'\);/g;
    const replacementText = "Runtime.Runtime.instance().extension(AppProvider.AppProvider).instance();";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyScreencastRepaintPatch(content: string) {
    // This patch removes a condition that calls repaint to restore scroll functionality
    const pattern = /\(this._highlightNode\)/g;
    const replacementText = "(true)";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyRemoveBreakOnContextMenuItem(content: string) {
    const pattern = /const breakpointsMenu\s+=[\s\S]+hasDOMBreakpoint\(.*\);\s+}\s+}/;
    const replacementText = "";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyShowDrawerTabs(content: string) {
    // Appends the Request Blocking tab or Whats New tab in the drawer even if it is not open.
    const pattern = /if\s*\(!view\.isCloseable\(\)\)/;
    const replacementText = "if(!view.isCloseable()||id==='network.blocked-urls'||id==='release-note')";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyPersistDrawerTabs(content: string) {
    // Removes the close button from the Request blocking and Whats New tab tab by making the tab non-closeable.
    const pattern = /this\._closeable\s*=\s*closeable;/;
    const replacementText = "this._closeable= (id==='network.blocked-urls' | id === 'release-note')?false:closeable;";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applySetTabIconPatch(content: string) {
    // Adding undefined check in SetTabIcon so it doesn't throw an error trying to access disabled tabs.
    // This is needed due to applyAppendTabPatch which removes unused tabs from the tablist.
    const pattern = /setTabIcon\(id,\s*icon\)\s*{\s*const tab\s*=\s*this\._tabsById\.get\(id\);/;
    const replacementText = "setTabIcon(id,icon){const tab=this._tabsById.get(id); if(!tab){return;}";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyAppendTabOverridePatch(content: string) {
    // The appendTab function chooses which tabs to put in the tabbed pane header section
    // showTabElement and selectTab are only called by tabs that have already been appended via appendTab.
    // Injecting our verifications by redirecting appendTab to appendTabOverride
    const pattern =
        /appendTab\(id,\s*tabTitle\s*,\s*view,\s*tabTooltip,\s*userGesture,\s*isCloseable,\s*index\)\s*{/;
    const replacementText = `appendTabOverride(id, tabTitle, view, tabTooltip, userGesture, isCloseable, index) {`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyAppendTabConditionsPatch(content: string) {
    const elementsTabs = [
        "elements",
        "Styles",
        "Computed",
        "accessibility.view",
        "elements.domProperties",
        "elements.eventListeners",
    ];

    const condition = elementsTabs.map((tab) => {
        return `id !== '${tab}'`;
    }).join(" && ");

    // We then replace with the verifications itself.
    const pattern = /return\s*tab\s*\?\s*tab\.isCloseable\(\)\s*:\s*false;\s*}/;
    const replacementText =
        `return tab ? tab.isCloseable() : false;}
        appendTab(id, tabTitle, view, tabTooltip, userGesture, isCloseable, index) {
            let patchedCondition = ${condition};
            ${applyEnableNetworkPatch()}
            console.log(Root.Runtime.vscodeSettings.whatsNew);
            if(Root.Runtime.vscodeSettings.whatsNew) {
              patchedCondition = patchedCondition && (id !== "release-note");
            }
            if (!patchedCondition) {
                this.appendTabOverride(id, tabTitle, view, tabTooltip, userGesture, isCloseable, index);
            }
        }`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyEnableNetworkPatch(): string {
    // Creates the condition to display or hide the network panel.
    const networkTabs = ["network",
        "network.blocked-urls",
        "network.search-network-tab",
        "headers",
        "preview",
        "response",
        "timing",
        "initiator",
        "cookies",
        "eventSource",
        "webSocketFrames",
        "preferences",
        "workspace",
        "experiments",
        "blackbox",
        "devices",
        "throttling-conditions",
        "emulation-geolocations",
        "Shortcuts"];

    const networkCondition = networkTabs.map((tab) => {
        return `id !== '${tab}'`;
    }).join(" && ");

    return `if(Root.Runtime.vscodeSettings.enableNetwork) {
        patchedCondition = patchedCondition && (${networkCondition});
    }`;
}

export function applyDefaultTabPatch(content: string) {
    // This patches removes the _defaultTab property
    const pattern = /this\._defaultTab\s*=\s*[^;]+;/g;
    const replacementText = "this._defaultTab=undefined;";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyDrawerTabLocationPatch(content: string) {
    // This shows the drawer with the network.blocked-urls tab open.
    const pattern = /this._showDrawer.bind\s*\(this,\s*false\),\s*'drawer-view',\s*true,\s*true/g;
    const replacementText = "this._showDrawer.bind\(this, false\), 'drawer-view', true, true, 'network.blocked-urls'";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorCommonCssPatch(content: string) {
    // Hides the more tools button in the drawer and reveals the screen cast button.
    const separator = "\\n";

    const hideMoreToolsBtn =
        `.toolbar-button[aria-label='More Tools'] {
            display: none !important;
        }`.replace(/\n/g, separator);

    const unHideScreenCastBtn =
        `.toolbar-button[aria-label='Toggle screencast'] {
            visibility: visible !important;
        }`.replace(/\n/g, separator);

    const topHeaderCSS =
        hideMoreToolsBtn +
        unHideScreenCastBtn;

    const pattern = /(:host-context\(\.platform-mac\)\s*\.monospace,)/g;
    const replacementText = `${topHeaderCSS}${separator} $1`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorCommonNetworkPatch(content: string) {
    // Hides export HAR button and pretty print button and reveals the Network search close button in the Network Panel.
    const separator = "\\n";

    const hideExportHarBtn =
        `.toolbar-button[aria-label='Export HAR...'] {
            display: none !important;
        }`.replace(/\n/g, separator);

    const hidePrettyPrintBtn =
        `.toolbar-button[aria-label='Pretty print'] {
            display: none !important;
        }`.replace(/\n/g, separator);

    // Search close button initially hidden by applyInspectorCommonCssRightToolbarPatch
    const unHideSearchCloseButton =
        `.toolbar-button[aria-label='Close'] {
            visibility: visible !important;
        }`.replace(/\n/g, separator);

    const networkCSS =
        hideExportHarBtn +
        hidePrettyPrintBtn +
        unHideSearchCloseButton;

    const pattern = /(:host-context\(\.platform-mac\)\s*\.monospace,)/g;
    const replacementText = `${networkCSS}${separator} $1`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorCommonContextMenuPatch(content: string) {
    // Hides certain context menu items from elements in the Network Panel.
    const separator = "\\n";

    const hideContextMenuItems =
        `.soft-context-menu-separator,
        .soft-context-menu-item[aria-label='Open in new tab'],
        .soft-context-menu-item[aria-label='Open in Sources panel'],
        .soft-context-menu-item[aria-label='Clear browser cache'],
        .soft-context-menu-item[aria-label='Clear browser cookies'],
        .soft-context-menu-item[aria-label='Save all as HAR with content'],
        .soft-context-menu-item[aria-label='Save as...'] {
            display: none !important;
        }`.replace(/\n/g, separator);

    const pattern = /(:host-context\(\.platform-mac\)\s*\.monospace,)/g;
    const replacementText = `${hideContextMenuItems}${separator} $1`;
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorCommonCssRightToolbarPatch(content: string) {
    const pattern = /(\.tabbed-pane-right-toolbar\s*\{([^\}]*)?\})/g;
    const replacementText =
        `.tabbed-pane-right-toolbar {
            visibility: hidden !important;
        }`.replace(/\n/g, "\\n");
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyInspectorCommonCssTabSliderPatch(content: string) {
    const pattern = /(\.tabbed-pane-tab-slider\s*\{([^\}]*)?\})/g;
    const replacementText =
        `.tabbed-pane-tab-slider {
            display: none !important;
        }`.replace(/\n/g, "\\n");
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyContextMenuRevealOption(content: string) {
    const pattern = /const destination\s*=\s*Revealer\.revealDestination\(revealable\);/;
    const replacementText = `
        let destination = Revealer.revealDestination(revealable);
        if (destination==="Sources panel") {
            destination = "Visual Studio Code";
        };`
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyMoveToContextMenuPatch(content: string) {
    const pattern = /const locationName\s*=\s*ViewManager\.instance\(\)\.locationNameForViewId\(tabId\);/;
    const replacementText = `return;`
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}

export function applyThemePatch(content: string) {
    // Sets the theme of the DevTools
    const pattern = /const settingDescriptor/;
    const replacementText = "const theme = Root.Runtime.vscodeSettings.theme;if(theme){themeSetting.set(theme);} const settingDescriptor";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyRemovePreferencePatch(content: string) {
    // This patch returns early whe trying to remove localStorage which we already set as undefined
    const pattern = /removePreference\(name\)\s*{\s*delete window\.localStorage\[name\];\s*}/;
    const replacementText = "removePreference(name){return;}";
    return replaceInSourceCode(content, pattern, replacementText);
}

export function applyRerouteConsoleMessagePatch(content: string) {
    const pattern = /this\.dispatchEventToListeners\(Events\$h\.MessageAdded,\s*msg\);/g;
    const replacementText = `sendToVscodeOutput(msg.level + ': ' + msg.messageText); ${sendToVscodeOutput.toString()}`;
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}

export function applyScreencastCursorPatch(content: string) {
    // This patch removes the touch cursor from the screencast view
    const pattern = /\('div',\s*'screencast-canvas-container'\)\);/g
    const replacementText = "this._canvasContainerElement.style.cursor = 'unset';";
    return replaceInSourceCode(content, pattern, replacementText, KeepMatchedText.InFront);
}
