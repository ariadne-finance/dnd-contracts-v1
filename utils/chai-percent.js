(function (plugin) {
  if (
    typeof require === "function" &&
    typeof exports === "object" &&
    typeof module === "object"
  ) {
    // NodeJS
    module.exports = plugin;
  } else if (typeof define === "function" && define.amd) {
    // AMD
    define(function () {
      return plugin;
    });
  } else {
    // Other environment (usually <script> tag): plug in to global chai instance directly.
    chai.use(plugin);
  }
})(function (chai, utils) {
  function anythingToBigInt(anything) {
    if (typeof anything == 'bigint') {
      return anything;
    }

    if (typeof anything == 'number') {
      return BigInt(anything);
    }

    if (anything._isBigNumber) {
      return anything.toBigInt();
    }

    return anything;
  }

  chai.Assertion.addChainableMethod('withinPercent', function(expected, deltaPercent) {
    const _actual = anythingToBigInt(this._obj);
    const _expected = anythingToBigInt(expected);

    const deltaPercentMultiplier = BigInt(deltaPercent * 1000);

    const delta = _expected * deltaPercentMultiplier / 100000n;
    const low = _expected - delta;
    const high = _expected + delta;

    return this.assert(
      _actual >= low && _actual <= high,
      `expected ${this._obj} to be within ${expected} +- ${deltaPercent}`,
      `expected ${this._obj} to not be within ${expected} +- ${deltaPercent}`,
      `${low.toString()} <= ${_actual.toString()} <= ${high.toString()}`,
      _actual.toString()
    );
  });
});
