"use strict";

var fs          = require("fs");
var connect     = require("connect");
var _           = require("lodash");
var through     = require("through");
var ports       = require("portscanner-plus");
var http        = require("http");
var serveStatic = require("serve-static");
var Q           = require("q");
var EE          = require("easy-extender");
var tmpl        = fs.readFileSync(__dirname + "/server/templates/plugin.tmpl", "utf-8");

var defaultPlugins = {
    "ghostmode": require("./server/plugins/ghostmode/ghostMode"),
    "urlsync": require("./server/plugins/urlsync/urlsync"),
    "urlinfo": require("./server/plugins/urlinfo/url-info")
};

var PLUGIN_NAME = "Control Panel";

/**
 * @constructor
 */
var ControlPanel = function (opts, bs) {

    opts = opts || {};

    this.logger = bs.getLogger(PLUGIN_NAME);
    this.bs     = bs;
    this.opts   = opts;

    this.pluginManager = new EE(defaultPlugins, {
        "markup": function (hooks, initial) {
            var out = hooks.reduce(function (combined, item) {
                return [combined, tmpl.replace("%markup%", item)].join("\n");
            }, "");
            return out;
        },
        "client:js": function (hooks) {
            var js = fs.readFileSync(__dirname + "/lib/js/dist/app.js", "utf-8");
            return [js, hooks.join(";")].join(";");
        }
    });

    this.pluginManager.init();

    this.pageMarkup = this.pluginManager.hook("markup");
    this.clientJs   = this.pluginManager.hook("client:js");

    ports.getPorts(1)
        .then(this.start.bind(this))
        .then(this.registerPlugins.bind(this))
        .catch(function (e) {
            this.logger
                .setOnce("useLevelPrefixes", true)
                .error("{red:%s", e);
        }.bind(this));

    return this;
};

ControlPanel.prototype.init = function () {
    return this;
};

/**
 * @param options
 * @returns {*}
 */
function startServer(options, socketMw, connectorMw, markup, clientJs) {

    var app = connect();
    app.use("/js/vendor/socket.js", socketMw);
    app.use("/js/connector", connectorMw);
    app.use("/js/app.js", function (req, res, next) {
        res.setHeader("Content-Type", "application/javascript");
        res.end(clientJs);
    });
    app.use(function (req, res, next) {
        if (req.url === "/") {
            res.setHeader("Content-Type", "text/html");
            return fs.createReadStream(__dirname + "/lib/index.html")
                .pipe(through(function (buffer) {
                    var file = buffer.toString();
                    this.queue(file.replace(/%hooks%/g, markup));
                }))
                .pipe(res);
        } else {
            next();
        }
    });
    app.use(serveStatic(__dirname + "/lib"));


    return http.createServer(app);
}

/**
 *
 */
ControlPanel.prototype.start = function (ports) {

    var deferred = Q.defer();
    var port     = ports[0];

    this.logger.info("Using port %s", port);

    var socketMw    = this.bs.getMiddleware("socket-js");
    var connectorMw = this.bs.getMiddleware("connector");

    var server = startServer(this.bs.options, socketMw, connectorMw, this.pageMarkup, this.clientJs);

    server.listen(port);

    this.logger.info("Running at: {cyan:http://localhost:%s", port);

    deferred.resolve(server);

    return deferred.promise;
};

/**
 * Interface required for BrowserSync
 * @returns {Function}
 */
function plugin(opts, bs) {
    var controlPanel = new ControlPanel(opts, bs).init();
    return controlPanel;
}

/**
 * @param opts
 * @param ports
 */
ControlPanel.prototype.registerPlugins = function (opts, ports) {
    this.pluginManager.get("ghostmode")(this, this.bs);
    this.pluginManager.get("urlsync")(this, this.bs);
    this.pluginManager.get("urlinfo")(this, this.bs);
};

/**
 * Module exports
 */
module.exports.hooks = {
    "client:js":         fs.readFileSync(__dirname + "/lib/js/includes/events.js"),
    "server:middleware": function () {
        return function (req, res, next) {
            next();
        };
    }
};

module.exports.plugin               = plugin;
module.exports["plugin:name"]       = PLUGIN_NAME;
module.exports.startServer          = startServer;

