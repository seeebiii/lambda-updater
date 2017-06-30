#!/usr/bin/env node

const opts = require('minimist')(process.argv.slice(2));
const ora = require('ora');
const yaml = require('js-yaml');
const cfnYamlSchema = require('cloudformation-js-yaml-schema');
const fs = require('fs');
const exec = require('child_process').exec;
const path = require('path');
const archiver = require('archiver');
const context = {};

let spinner = null;


preparation(opts).then(archiveFile).then(getFunctionNames).then(updateFunctions).catch(err => {
    try {
        if (spinner !== null) {
            console.log(err);
            spinner.fail(err);
        } else {
            console.log(err);
        }
    } catch (e) {
        console.log(e);
        console.log(err);
    }
});


function preparation(opts) {
    return new Promise((resolve, reject) => {
        const cfn = opts.cfn;
        const stack = opts.stack;
        const target = opts.target;
        const funcName = opts.functionName;
        const debug = opts.debug;

        if (!cfn || !stack || !target) {
            reject('Usage: lambda-updater --cfn path --stack stack-name --target jsFileOrJar [--functionName name] [--debug]');
        } else {
            context.opts = {
                cfn,
                stack,
                target,
                funcName,
                debug
            };
            _debug('Using options: ', context.opts);
            resolve(context);
        }
    });
}


function archiveFile(context) {
    return new Promise((resolve, reject) => {
        spinner = ora('Zipping files...').start();

        const output = fs.createWriteStream(__dirname + '/target.zip');
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });
        archive.pipe(output);
        output.on('close', () => {
            spinner.succeed('Zipped file.');
            _debug('Total bytes for zip file: ', archive.pointer());
            resolve(context);
        });
        archive.on('error', err => {
            reject(err);
        });

        let targetType = '';
        let zipFileLocation = '';
        let target = context.opts.target;

        if (target.indexOf('.jar') > -1) {
            targetType = 'java';
            zipFileLocation = target;
            if (!path.isAbsolute(zipFileLocation)) {
                zipFileLocation = path.resolve('.') + '/' + zipFileLocation;
            }
            // we don't need to zip the code, because a jar file is already a zip
        } else if (target.indexOf('.js') > -1) {
            targetType = 'node';
            zipFileLocation = __dirname + '/target.zip';
            const fileName = target.substring(target.lastIndexOf('/'));
            archive.file(target, { name: fileName });
        } else {
            reject('Unsupported file type. Only .js and .jar are supported at the moment.');
        }

        _debug('Zip file location: ', zipFileLocation);
        _debug('Target type: ', targetType);

        if (!path.isAbsolute(zipFileLocation)) {
            spinner.fail('Path to zip file is relative, but we need an absolute path. Path: ', zipFileLocation);
            return;
        }

        context.archive = {
            targetType: targetType,
            zipFileLocation: zipFileLocation
        };

        archive.finalize();
    });
}


function getFunctionNames(context) {
    return new Promise((resolve, reject) => {
        // if no function name is provided: use all valid functions which match target type
        // otherwise use provided function name and find physical name

        spinner = ora('Collecting function(s) to update...').start();

        try {
            let promises = [];
            const doc = yaml.safeLoad(fs.readFileSync(context.opts.cfn, 'utf8'), { schema: cfnYamlSchema.CLOUDFORMATION_SCHEMA });
            const tmpFunctions = _getPotentialFunctionNames(doc, context.opts.funcName);

            for (let i = 0; i < tmpFunctions.length; i++) {
                const func = tmpFunctions[i];

                // consider that also 'normal' resources are defined in a CF file, so check that properties exist!
                let properties = doc['Resources'][func].Properties;
                if (properties && properties.Runtime && properties.Runtime.indexOf(context.archive.targetType) > -1) {
                    const cmd = `aws cloudformation describe-stack-resources --stack-name ${context.opts.stack} --logical-resource-id ${func} --query "StackResources[].PhysicalResourceId" --output text`;
                    promises.push(_getCmdPromise(cmd));
                }
            }

            if (promises.length === 0) {
                reject('No function(s) found for an update.');
            } else {
                Promise.all(promises).then(data => {
                    spinner.succeed(`Found ${data.length} potential function(s) to update.`);
                    context.functions = data;
                    resolve(context);
                }).catch(reject);
            }
        } catch (e) {
            spinner.fail('Something failed when collecting function(s) to update.');
            reject('Error: ', e);
        }
    });
}


function updateFunctions(context) {
    return new Promise((resolve, reject) => {
        let functions = context.functions;
        _debug('Collected function names: ', functions);

        spinner = ora(`Updating function(s)...`).start();

        let updates = [];

        for (let i = 0; i < functions.length; i++) {
            let functionName = functions[i];
            if (functionName) {
                const cmd = `aws lambda update-function-code --function-name ${functionName} --zip-file fileb://${context.archive.zipFileLocation}`;
                updates.push(_getCmdPromise(cmd, functionName));
            } else {
                _debug('Ignoring function name, because it is undefined.');
            }
        }

        Promise.all(updates).then(updatedFunctions => {
            spinner.succeed(`Updated ${updatedFunctions.length} function(s):  ${updatedFunctions}`);
        }).catch(reject);
    });
}


///// === HELPER === /////

function _getCmdPromise(cmd, resolveObj) {
    _debug('Executing command: ', cmd);
    return new Promise((resolve, reject) => {
        exec(cmd, function(err, stdout, stderr) {
            if (err) {
                reject(`Error while executing command: "${cmd}": ${err}`);
            } else if (!resolveObj && stdout) {
                if (stdout.indexOf('\n') > -1) {
                    resolve(stdout.substring(0, stdout.indexOf('\n')));
                } else {
                    resolve(stdout);
                }
            } else if (resolveObj) {
                resolve(resolveObj);
            } else {
                resolve();
            }
        });
    });
}


function _getPotentialFunctionNames(doc, funcName) {
    let tmpFunctions = [];
    if (!funcName) {
        tmpFunctions = Object.keys(doc['Resources']);
    } else {
        tmpFunctions = [funcName];
    }
    _debug('Found potential resources in YAML file: ', tmpFunctions);
    return tmpFunctions;
}


function _debug(message, object) {
    if (context.opts.debug) {
        console.log("[Debug] " + message, JSON.stringify(object));
    }
}