#ifdef 0
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
#endif

/**
 * This singleton allows to transform the grid by repositioning a site's node
 * in the DOM and by showing or hiding the node. It additionally provides
 * convenience methods to work with a site's DOM node.
 */
let gTransformation = {
  /**
   * Gets a DOM node's position.
   * @param aNode The DOM node.
   * @return A Rect instance with the position.
   */
  getNodePosition: function Transformation_getNodePosition(aNode) {
    let {left, top, width, height} = aNode.getBoundingClientRect();
    return new Rect(left + scrollX, top + scrollY, width, height);
  },

  /**
   * Fades a given node from zero to full opacity.
   * @param aNode The node to fade.
   * @param aCallback The callback to call when finished.
   */
  fadeNodeIn: function Transformation_fadeNodeIn(aNode, aCallback) {
    this._setNodeOpacity(aNode, 1, function () {
      // Clear the style property.
      aNode.style.opacity = "";

      if (aCallback)
        aCallback();
    });
  },

  /**
   * Fades a given node from full to zero opacity.
   * @param aNode The node to fade.
   * @param aCallback The callback to call when finished.
   */
  fadeNodeOut: function Transformation_fadeNodeOut(aNode, aCallback) {
    this._setNodeOpacity(aNode, 0, aCallback);
  },

  /**
   * Fades a given site from zero to full opacity.
   * @param aSite The site to fade.
   * @param aCallback The callback to call when finished.
   */
  showSite: function Transformation_showSite(aSite, aCallback) {
    this.fadeNodeIn(aSite.node, aCallback);
  },

  /**
   * Fades a given site from full to zero opacity.
   * @param aSite The site to fade.
   * @param aCallback The callback to call when finished.
   */
  hideSite: function Transformation_hideSite(aSite, aCallback) {
    this.fadeNodeOut(aSite.node, aCallback);
  },

  /**
   * Allows to set a site's position.
   * @param aSite The site to re-position.
   * @param aPosition The desired position for the given site.
   */
  setSitePosition: function Transformation_setSitePosition(aSite, aPosition) {
    let style = aSite.node.style;
    let {top, left} = aPosition;

    style.top = top + "px";
    style.left = left + "px";
  },

  /**
   * Freezes a site in its current position by positioning it absolute.
   * @param aSite The site to freeze.
   */
  freezeSitePosition: function Transformation_freezeSitePosition(aSite) {
    aSite.node.setAttribute("frozen", "true");
    this.setSitePosition(aSite, this.getNodePosition(aSite.node));
  },

  /**
   * Unfreezes a site by removing its absolute positioning.
   * @param aSite The site to unfreeze.
   */
  unfreezeSitePosition: function Transformation_unfreezeSitePosition(aSite) {
    let style = aSite.node.style;
    style.left = style.top = "";
    aSite.node.removeAttribute("frozen");
  },

  /**
   * Slides the given site to the target node's position.
   * @param aSite The site to move.
   * @param aTarget The slide target.
   * @param aOptions Set of options (see below).
   *        unfreeze - unfreeze the site after sliding
   *        callback - the callback to call when finished
   */
  slideSiteTo: function Transformation_slideSiteTo(aSite, aTarget, aOptions) {
    let currentPosition = this.getNodePosition(aSite.node);
    let targetPosition = this.getNodePosition(aTarget.node)
    let callback = aOptions && aOptions.callback;

    let self = this;

    function finish() {
      if (aOptions && aOptions.unfreeze)
        self.unfreezeSitePosition(aSite);

      if (callback)
        callback();
    }

    // Nothing to do here if the positions already match.
    if (currentPosition.equals(targetPosition)) {
      finish();
    } else {
      this.setSitePosition(aSite, targetPosition);
      this._whenTransitionEnded(aSite.node, finish);
    }
  },

  /**
   * Rearranges a given array of sites and moves them to their new positions or
   * fades in/out new/removed sites.
   * @param aSites An array of sites to rearrange.
   * @param aOptions Set of options (see below).
   *        unfreeze - unfreeze the site after rearranging
   *        callback - the callback to call when finished
   */
  rearrangeSites: function Transformation_rearrangeSites(aSites, aOptions) {
    let batch;
    let cells = gGrid.cells;
    let callback = aOptions && aOptions.callback;
    let unfreeze = aOptions && aOptions.unfreeze;

    if (callback) {
      batch = new Batch(callback);
      callback = function () batch.pop();
    }

    aSites.forEach(function (aSite, aIndex) {
      // Do not re-arrange empty cells or the dragged site.
      if (!aSite || aSite == gDrag.draggedSite)
        return;

      if (batch)
        batch.push();

      if (!cells[aIndex])
        // The site disappeared from the grid, hide it.
        this.hideSite(aSite, callback);
      else if (this._getNodeOpacity(aSite.node) != 1)
        // The site disappeared before but is now back, show it.
        this.showSite(aSite, callback);
      else
        // The site's position has changed, move it around.
        this._moveSite(aSite, aIndex, {unfreeze: unfreeze, callback: callback});
    }, this);

    if (batch)
      batch.close();
  },

  /**
   * Listens for the 'transitionend' event on a given node and calls the given
   * callback.
   * @param aNode The node that is transitioned.
   * @param aCallback The callback to call when finished.
   */
  _whenTransitionEnded:
    function Transformation_whenTransitionEnded(aNode, aCallback) {

    aNode.addEventListener("transitionend", function onEnd() {
      aNode.removeEventListener("transitionend", onEnd, false);
      aCallback();
    }, false);
  },

  /**
   * Gets a given node's opacity value.
   * @param aNode The node to get the opacity value from.
   * @return The node's opacity value.
   */
  _getNodeOpacity: function Transformation_getNodeOpacity(aNode) {
    let cstyle = window.getComputedStyle(aNode, null);
    return cstyle.getPropertyValue("opacity");
  },

  /**
   * Sets a given node's opacity.
   * @param aNode The node to set the opacity value for.
   * @param aOpacity The opacity value to set.
   * @param aCallback The callback to call when finished.
   */
  _setNodeOpacity:
    function Transformation_setNodeOpacity(aNode, aOpacity, aCallback) {

    if (this._getNodeOpacity(aNode) == aOpacity) {
      if (aCallback)
        aCallback();
    } else {
      if (aCallback)
        this._whenTransitionEnded(aNode, aCallback);

      aNode.style.opacity = aOpacity;
    }
  },

  /**
   * Moves a site to the cell with the given index.
   * @param aSite The site to move.
   * @param aIndex The target cell's index.
   * @param aOptions Options that are directly passed to slideSiteTo().
   */
  _moveSite: function Transformation_moveSite(aSite, aIndex, aOptions) {
    this.freezeSitePosition(aSite);
    this.slideSiteTo(aSite, gGrid.cells[aIndex], aOptions);
  }
};
