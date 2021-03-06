/*jslint forin:true sub:true anon:true, sloppy:true, stupid:true nomen:true, node:true continue:true*/

/*
 * Copyright (c) 2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

var fs = require("fs");
var glob = require("glob");
var path = require('path');
var async = require('async');
var Properties = require("../util/properties");
var log4js = require("log4js");
var LibManager = require('../util/libmanager');
var FileUtil = require("../util/fileutil");
var ErrorManager = require("../util/errormanager");
var PhantomJsSetup = require("./phantomJsSetup.js");
var Servermanager = require("../../arrow_server/arrowservermanager.js");

function ArrowSetup(config, argv) {
    var __dirname = global.appRoot;
    this.config = config;
    this.argv = argv;
}

ArrowSetup.prototype.setup = function (callback) {
    var self = this;

    async.series(
        [
            function(cb) {
                self.setuplog4js(function() {
                    return cb(null, 'setuplog4js');
                });
            },

            function(cb) {
                self.setupReportDir(function() {
                    return cb(null, 'setupReportDir');
                });
            },

            function(cb) {
                self.setupDefaultDriverName(function() {
                    return cb(null, 'setupDefaultDriverName');
                });
            },

            function(cb) {
                self.setupTestEngine(function() {
                    return cb(null, 'setupTestEngine');
                });
            },

            function(cb) {
                self.setupDefaultLib(function() {
                    return cb(null, 'setupDefaultLib');
                });
            },

            function(cb) {
                self.setupHeadlessParam(function() {
                    return cb(null, 'setupHeadlessParam');
                });
            },

            function(cb) {
                self.setupCapabilities(function() {
                    return cb(null, 'setupCapabilities');
                });
            },

            function(cb) {
                self.setupMisc(function() {
                    return cb(null, 'setupMisc');
                });
            },

            function(cb) {
                self.setupReplaceParam(function() {
                    return cb(null, 'setupReplaceParam');
                });
            },

            function(cb) {
                self.setupDefaultParam(function() {
                    return cb(null, 'setupDefaultParam');
                });
            },

            function(cb) {
                self.startPhantomJs(function() {
                    return cb(null, 'startPhantomJs');
                });
            },

            function(cb) {
                self.startArrowServer(function() {
                    return cb(null, 'startArrowServer');
                });
            },


            function(cb) {
                self.errorCheck(function() {
                    return cb(null, 'errorCheck');
                });
            }

        ],
        function(err, results) {
            callback();
        }
    );

};

ArrowSetup.prototype.setupReplaceParam = function (cb) {

    var self = this;
    self.logger.trace('setupReplaceParam starts');
    if (this.argv.replaceParamJSON) {
        this.config.replaceParamJSON = this.argv.replaceParamJSON;
    }
    self.logger.trace('setupReplaceParam ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupDefaultParam = function (cb) {

    var self = this;
    self.logger.trace('setupDefaultParam starts');
    if (this.argv.defaultParamJSON) {
        this.config.defaultParamJSON = this.argv.defaultParamJSON;
    }
    self.logger.trace('setupDefaultParam ends');
    if (cb) {
        cb();
    }

};


ArrowSetup.prototype.errorCheck = function (cb) {

    var self = this, em = ErrorManager.getInstance(),
        environment = function() {
            if (self.argv.argv.cooked) {
                // em.errorLog("self.argv.argv.cooked {0}",  JSON.stringify(self.argv.argv.cooked));
                var cooked = JSON.stringify(self.argv.argv.cooked), proc = self.mock || process;
                cooked.replace(/"--context","([\w\W]*?)"/, function (match, context) {
                    // em.errorLog("match is {0}, context is {1}", match, context);
                    context.replace(/environment:([\w\W]*)/, function (match, env) {
                        // em.errorLog("match is {0}, env is {1}", match, env);
                        if (self.dimensions[0].environment[env] === undefined) {
                            em.errorLog(1000, env, self.dimensionsFile);
                            proc.exit(1);
                        } else {
                            self.environment = env;
                        }
                    });
                });
            }
        },
        dimensions = function() {
            // To Do : should check dimensions file with Json schema
            // em.errorLog("config {0} argv {1}", JSON.stringify(self.config), JSON.stringify(self.argv));
            var dimensions = self.argv.dimensions || self.config.dimensions || "", dimJson, i = 0, proc = self.mock || process,
                errorMessage, argv = self.argv.argv || {}, remain = JSON.stringify(argv.remain) || "",
                dimensionsExist = function () {
                    return remain.match(/"[\w\W]*\.json"/) && dimensions.length > 0;
                };

            if (dimensionsExist()) {
                try {
                    self.dimensionsFile = dimensions;
                    dimJson = JSON.parse(fs.readFileSync(dimensions, "utf-8"));
                } catch (e) {
                    errorMessage = e.message;
                }
                if (dimJson && dimJson.length > 0 && dimJson[i].dimensions) {
                    self.dimensions = dimJson[i].dimensions;
                    // em.errorLog("dimensions {0}", JSON.stringify(self.dimensions));
                } else {
                    em.errorLog(1001, dimensions, errorMessage || JSON.stringify(dimJson));
                    proc.exit(1);
                }
                environment();
            }
        },
        invalidArgument = function() {
            var argv = self.argv, arg, value, isNotValid = false, proc = self.mock || process,
                mandatory = { "seleniumHost" : true };
            for (arg in argv) {
                if (mandatory[arg] === undefined || !mandatory[arg]) {
                    continue;
                }
                value = argv[arg];
                if (value === null || value === "null") {
                    em.errorLog(1006, arg, "null");
                    isNotValid = true;
                } else if (value === '') {
                    em.errorLog(1006, arg, "empty string");
                    isNotValid = true;
                } else if (value === undefined) {
                    em.errorLog(1006, arg, "undefined");
                    isNotValid = true;
                }
            }
            if (isNotValid) {
                proc.exit(1);
            }
            dimensions();
        };

    em.logger = self.mock || em.logger;
    invalidArgument();
    self.logger.trace('errorCheck ends..' + cb);
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupReportDir = function (cb) {

    var self = this;
    self.logger.trace('setupReportDir starts');
    global.reportFolder = "";
    // To generate the reports, if either report is true or reportFolder is passed
    if (this.argv.reportFolder || true === this.argv.report) {

        var fileUtil = new FileUtil(),
            targetFolderPath,
            reportFolderPath;

        // If reportFolder is passed in the argument,
        if (this.argv.reportFolder) {
            targetFolderPath =  path.resolve(global.workingDirectory, this.argv.reportFolder, 'arrow-target');
        } else {
            // Report folder not passed by the user
            // By default, reports shall go under arrow-target/reports
            targetFolderPath =  path.resolve(global.workingDirectory, 'arrow-target');
        }

        // Cleanup report folder if keepTestReport set to false or undefined
        if (this.argv.keepTestReport === undefined || false === this.argv.keepTestReport) {
            fileUtil.removeDirectory(targetFolderPath);
        }

        reportFolderPath = path.resolve(targetFolderPath, 'arrow-report');

        fileUtil.createDirectory(reportFolderPath);

        this.argv.reportFolder = targetFolderPath;
        global.reportFolder = this.argv.reportFolder || "";
        self.logger.trace('setupReportDir ends');
        if (cb) {
            cb();
        }
    } else {
        self.logger.trace('setupReportDir ends');
        if (cb) {
            cb();
        }

    }
};

ArrowSetup.prototype.setupMisc = function (cb) {

    var self = this;
    self.logger.trace('setupMisc starts');
    if (this.argv.coverage !== undefined) {
        this.config.coverage = this.argv.coverage;
    }

    if (this.argv.report === undefined && this.config.report) {
        this.argv.report = this.config.report;
    }

    if (this.argv.dimensions) {
        this.argv.dimensions = path.resolve(global.workingDirectory, this.argv.dimensions);
        this.config.dimensions = this.argv.dimensions;
    }
    self.logger.trace('setupMisc ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setuplog4js = function (cb) {

    var logLevel;
    logLevel = this.config["logLevel"];
    log4js.setGlobalLogLevel(logLevel);
    log4js.restoreConsole();
    this.logger = log4js.getLogger("ArrowSetup");
    this.logger.trace('setuplog4js ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupDefaultDriverName = function (cb) {

    var self = this;
    self.logger.trace('setupDefaultDriverName starts');
    // turn on reuseSession, if browser is being reused
    // adding support for "reuse-" too, just in case if a null version is passed with browser.
    if ("reuse" === this.argv.browser || "reuse-" === this.argv.browser) {
        this.argv.reuseSession = true;

        if (!this.argv.driver) {
            this.argv.driver = "selenium";
        }
        delete this.argv.browser;
    }

    // setup the selenium host using the auto hookup if possible
    this.setupSeleniumHost(function() {
        self.logger.trace('setupDefaultDriverName ends');
        if (cb) {
            cb();
        }

    });

};

ArrowSetup.prototype.setupSeleniumHost = function (cb) {

    var self = this;
    self.logger.trace('In setupSeleniumHost starts');
    var wdHubHost,
        wdStatusFile = "/tmp/arrow_sel_server.status";

    // setup the selenium host using the auto hookup if possible
    wdHubHost = this.config["seleniumHost"];
    if (0 === wdHubHost.length) {
        // check if we have a hooked up server
        try {
            fs.statSync(wdStatusFile).isFile();
            wdHubHost = fs.readFileSync(wdStatusFile, "utf-8");
        } catch (ex) {
        }

        // final default
        if (wdHubHost.length === 0) {
            wdHubHost = "http://localhost:4444/wd/hub";
        }
        this.config["seleniumHost"] = wdHubHost;
        self.logger.trace('setupSeleniumHost ends');
        if (cb) {
            cb();
        }

    } else {
        self.logger.trace('setupSeleniumHost ends');
        if (cb) {
            cb();
        }

    }

};

ArrowSetup.prototype.setupDefaultLib = function (cb) {

    var self = this;
    self.logger.trace('setupDefaultLib starts');
    this.argv.lib = new LibManager().getAllCommonLib(this.config, this.argv.lib);
    this.logger.debug("Commandline + Common Libs for Test :" + this.argv.lib);
    self.logger.trace('setupDefaultLib ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupHeadlessParam = function (cb) {

    var self = this,
        hd,
        results,
        ext;

    self.logger.trace('setupHeadlessParam starts');

    if (!this.argv.argv.remain[0]) {
        self.logger.trace('setupHeadlessParam ends');
        if (cb) {
            cb();
        }

    }

    hd = this.argv.argv.remain[0];

    results = glob.sync(hd);
    this.logger.info("Glob result: " + results);

    if (0 === results.length) {
        this.logger.error("ERROR : No Test or Descriptor Found, while looking for : " + hd);
        process.exit(1);
    }

    ext = path.extname(results[0]);
    // check the first file to determine the type
    if (".json" === ext) {
        this.config.arrDescriptor = results;
    } else if ((".js" === ext) || (".html" === ext)) {
        if (results.length > 1) {
            this.argv.tests = results;
        } else {
            this.argv.test = results[0];
        }
    } else {
        this.logger.fatal("Unknown test file type " + results[0]);
        process.exit(0);
    }
    self.logger.trace('setupHeadlessParam ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupCapabilities = function (cb) {

    var self = this;
    self.logger.trace('setupCapabilities starts');
    if (this.argv.capabilities) {
        this.config.capabilities = this.argv.capabilities;
    }
    self.logger.trace('setupCapabilities ends');
    if (cb) {
        cb();
    }

};

ArrowSetup.prototype.setupTestEngine = function (cb) {

    var self = this;
    self.logger.trace('setupTestEngine starts');
    this.config.engine = "yui";
    if (this.argv.engine) {
        this.config.engine = this.argv.engine;
    }
    if (this.argv.engineConfig) {
        try {
            this.config.engineConfig = this.argv.engineConfig;
            if (fs.statSync(this.argv.engineConfig).isFile()) {
                //get absolute path before chdir
                this.config.engineConfig = path.resolve("", this.argv.engineConfig);
            }
            self.logger.trace('setupTestEngine ends');
            if (cb) {
                cb();
            }

        } catch (e) {
            self.logger.trace('setupTestEngine ends');
            if (cb) {
                cb();
            }

        }
    } else {
        self.logger.trace('setupTestEngine ends');
        if (cb) {
            cb();
        }

    }

};

ArrowSetup.prototype.startArrowServer = function(cb) {

    var self = this;
    self.logger.trace('startArrowServer starts');
    if (this.argv.startArrowServer) {
        Servermanager.startArrowServer(function(arrowServerStarted) {
            if (arrowServerStarted === false) {
                self.logger.info('Failed to start Arrow Server. Exiting !!!');
                process.exit(1);
            }
            self.logger.trace('startArrowServer ends');
            if (cb) {
                cb();
            }

        });
    } else {
        self.logger.trace('startArrowServer ends');
        if (cb) {
            cb();
        }

    }

};

ArrowSetup.prototype.startPhantomJs = function(cb) {

    var self = this;
    self.logger.trace('startPhantomJs starts');

    if (this.argv.startPhantomJs) {

        PhantomJsSetup.startPhantomJs(self.config.ignoreSslErrorsPhantomJs, function(phantomHost) {
            self.logger.trace('startPhantomJs ends..' + phantomHost);

            if (!phantomHost) {
                self.logger.info('Could not start phantomjs. Exiting.');
                process.exit(1);
            }

            self.config["phantomHost"] = phantomHost;
            if (cb) {
                cb();
            }
        });
    } else if (cb) {
        self.logger.trace('startPhantomJs ends');
        cb();
    }

};

module.exports = ArrowSetup;