var real = require("D:\\GITHUB\\nexttrade-hub\\src\\lib\\bank-visibility.js");
module.exports = Object.assign({}, real, { authorizeBankVisibility: function () { if (!global.__slAccess) { throw new real.BankVisibilityError("Sign in to use bank data.", 401); } return Promise.resolve(global.__slAccess); } });
