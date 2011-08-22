// Libraries
var jsdom = require("jsdom").jsdom;
var fs = require("fs");
var assert = require("assert");
var colors = require("colors");
var sys = require("sys");
var path = require("path");
var console = require("console");

// regexes
var testMethodRe = /^test.*/i

// reporting print helpers
var bigBar =
 "=========================================================================="
var littleBar =
 "--------------------------------------------------------------------------"

// default libraries to load (can be overwritten per-test)
exports.defaultGlobals = [];

/* This is the object passed between all the test, with lots of shortcuts. */
var TestParams = function(currentTest, report, finalCallback) {

    var handleError = function(error, callback) {
        if (error.name === "AssertionError") {
            report.addFailure(error, currentTest.name)
        } else {
            report.addError(error, currentTest.name);
        }
        if (callback) {
            callback();
        }
    }

    var begin = function() {
        if (currentTest.setUp) {
            try {
                currentTest.setUp(testParams);
            } catch (error) {
                // blank teardown because setup failed
                handleError(error, function() {});
            }
        } else {
            start();
        }
    };

    var start = function() {
        /* called by setUp */
        try {
            currentTest.test(testParams);
        } catch (error) {
            handleError(error, tearDown);
        }
    };

    var finish = function() {
        finalCallback();
    };

    var tearDown = function() {
        // test gets here on success or failure.
        if (currentTest.tearDown) {
            currentTest.tearDown(testParams);
        } else {
            finish();
        }
    };

    var done = function() {
        /* Test only gets here if successful. */
        report.addSuccess(currentTest.name);
        tearDown();
    };

    var testParams = {
        wrap: function(testCallback) {
            var wrapped = function() {
                try {
                    testCallback.apply(testCallback, arguments);
                } catch (error) {
                    handleError(error, finish);
                }
            }
            return wrapped;
        },

        globals: {}, // for user's to overwrite

        /* test workflow methods */
        begin: begin,
        start: start,
        done: done,
        finish: finish,
        path: currentTest.path
    }

    /* Setting up the assert functions. */
    var assertions = ["ok", "fail", "equal", "notEqual", "deepEqual",
        "notDeepEqual", "strictEqual", "notStrictEqual", "throws",
        "doesNotThrow","ifError"];
    assertions.forEach(function(attr) {
        testParams[attr] = assert[attr];
    });

    return testParams;
};

var runTest = function(testFile, report) {
    // apeing the behavior of nodeunit here.
    var testCase = require(path.resolve(testFile));
    var namespace = (testCase.name) ? testCase.name : "<unnamed>";
    var tests = []
    for (attr in testCase) {
        if (testCase.hasOwnProperty(attr) && attr.match(testMethodRe)) {
            var testFunc = testCase[attr];
            var isFunc = typeof testFunc !== "undefined";
            var testObj = {
                setUp: testCase.setUp,
                test: testFunc,
                path: testFile,
                name: namespace+"."+attr,
                tearDown: testCase.tearDown
            };
            if (isFunc) {
                tests.push(testObj);
            }
        }
    }
    var getProxy = new ProxyCallback(report.finishSuite, tests.length);
    for (var i=0; i<tests.length; i++) {
        var currentTest = tests[i];
        (function(currentTest) {
            var proxy = getProxy();
            var params = new TestParams(currentTest, report, proxy);
            params.begin();
        })(currentTest);
    }
};

exports.runTest = runTest;

var testCase = function(name, properties) {
    // Just a friendlier wrapper right now.
    properties.name = name;
    return properties;
};

exports.testCase = testCase;

var ProxyCallback = function(callback, totalCalls) {

    var decrement = function() {
        totalCalls--;
        if (totalCalls === 0) {
            process.nextTick(callback);
        }
    };

    var getCallback = function() {
        return decrement;
    };

    return getCallback;
};

exports.ProxyCallback = ProxyCallback;

var TestReport = function (totalSuites, options) {
    /* manages all of the finished statuses */
    var errors = [];
    var failures = [];
    var successes = [];
    var verbose = (options) ? options.verbose === true : false;
    var finishedSuites = 0;

    var finishSuite = function() {
        finishedSuites += 1;
    };

    var hasFailed = function() {
        if ((errors.length + failures.length) >= 1) {
            return true;
        }
        return false;
    };

    var isFinished = function() {
        return totalSuites === finishedSuites;
    };

    var addError = function(error, name) {
        errors.push({error:error, name:name});
        sys.print(".".bold.yellow);
    };

    var addFailure = function(error, name) {
        failures.push({error:error, name:name});
        sys.print(".".bold.red);
    };

    var addSuccess = function(name) {
        sys.print(".".bold.green);
        successes.push({name: name});
    };

    var generateReport = function() {
        sys.print("\n");
        var total = errors.length + failures.length + successes.length;

        if (verbose) {
            for (var i=0; i<successes.length; i++) {
                var success = successes[i];
                sys.puts("SUCCESS".bold.green+" on "+success.name.bold.green);
            }
        }
        for (i=0; i<errors.length; i++) {
            var error = errors[i];
            var message = "ERROR on "+error.name;
            sys.puts(bigBar);
            sys.puts(message.bold.yellow);
            sys.puts(littleBar);
            sys.puts(error.error.stack.yellow);
        }
        for (i=0; i<failures.length; i++) {
            var failure = failures[i];
            var message = "FAILURE on "+failure.name;
            sys.puts(bigBar);
            sys.puts(message.bold.red);
            sys.puts(littleBar);
            sys.puts(failure.error.stack.red);
        }
        sys.puts(littleBar);
        sys.puts((successes.length+" successes").bold.green + " "+
                 (errors.length+" errors").bold.yellow + " "+
                 (failures.length+" failures").bold.red);
    };

    return {
        generateReport: generateReport,
        addSuccess: addSuccess,
        addError: addError,
        addFailure: addFailure,
        finishSuite: finishSuite,
        isFinished: isFinished,
        hasFailed: hasFailed
    };
};

exports.TestReport = TestReport;

// the main function used for tests
exports.domTestCase = function(name, overrideOptions) {
    
    // the window "globals" (like $ for jQuery) to make available
    // on the test object
    var exportGlobals = (overrideOptions.exportGlobals) ?
        overrideOptions.exportGlobals : [];
    // some sane defaults (jQuery, underscore)
    exportGlobals = exportGlobals.concat(exports.defaultGlobals);

    var htmlPath = overrideOptions.htmlPath;
    var html = (overrideOptions.html) ? overrideOptions.html :
        "<html><head></head><body></body></html>";
    if (htmlPath) {
        html = fs.readFileSync(htmlPath).toString();
    }
    var scripts = (overrideOptions.scripts) ?
        overrideOptions.scripts : [];

    // default setUp function, wraps the override setUp function
    var setUp = function(test) {
        // seems like there should be a more efficient way, but
        // we don't have access to the path outside of test.
        // set up default (empty) HTML or override
        var basePath = path.dirname(test.path);
        // a relative or absolute path to the javascript directory
        var scriptPath = (overrideOptions.scriptPath) ?
            path.resolve(basePath, overrideOptions.scriptPath) : 
                basePath;
        if (!scriptPath.substr(-1) === "/") {
            scriptPath += "/";
        }

        var pageScripts = [];

        // include any "manual" script paths
        for (i=0; i<scripts.length; i++) {
            // combine scriptPath to scripts
            var newPath = path.resolve(scriptPath, scripts[i]);
            pageScripts[i] = fs.readFileSync(newPath).toString();
        }
        // concatenate scripts to one big file (seems quite silly, better way?)
        pageScripts = pageScripts.join("\n");

        var finalSetup = test.start;
        if (overrideOptions.setUp) {
            finalSetup = function() {
                overrideOptions.setUp(test);
            }
        }
        jsdom.env({
            html: html,
            src: pageScripts,
            done: test.wrap(function(errors, window) {
                test.globals.window = window;
                test.globals.document = window.document;
                for (var i=0; i<exportGlobals.length; i++) {
                    var exportGlobal = exportGlobals[i];
                    var globalType = typeof window[exportGlobal];
                    if (globalType != "undefined") {
                        test.globals[exportGlobal] = window[exportGlobal];
                    } else {
                        console.log("Unknown global "+exportGlobal);
                    }
                }
                finalSetup();
            })
        });
    }

    // the default test options
    var baseTestOptions = {
        name: (name) ? name : overrideOptions.name,
        setUp: setUp
    };

    // look for test methods in the options passed in
    for (var obj in overrideOptions) {
        if (!overrideOptions.hasOwnProperty(obj)) {
            // not sure this is as necessary in node?
            continue;
        }
        if (!obj.match(/^test/i)) {
            // does not start with "test"
            continue;
        }
        // attach test methods / attributes to domTest object
        baseTestOptions[obj] = overrideOptions[obj];
    }

    // default teardown
    baseTestOptions.tearDown = (overrideOptions.tearDown) ?
        overrideOptions.tearDown : null;

    // return new wrapped test case
    return baseTestOptions;
};
