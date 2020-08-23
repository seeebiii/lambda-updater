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


prepare(opts)
    .then(archiveFile)
    .then(getFunctionNames)
    .then(updateFunctions)
    .catch(err => {
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


function prepare(opts) {
    return new Promise((resolve, reject) => {
        const cfn = opts.cfn;
        const stack = opts.stack;
        const target = opts.target;
        const funcName = opts.functionName;
        const debug = opts.debug;
        const useS3 = opts.useS3;

        if (!cfn || !stack || !target) {
            reject('Usage: lambda-updater --cfn path --stack stack-name --target jsFileOrJar [--functionName name] [--useS3 s3BucketName] [--debug]');
        } else {
            context.opts = {
                cfn,
                stack,
                target,
                funcName,
                debug,
                useS3
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
            zlib: {level: 9} // Sets the compression level.
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
            archive.file(target, {name: fileName});
        } else {
            reject('Unsupported file type. Only .js and .jar are supported at the moment.');
            return;
        }

        _debug('Target type: ', targetType);
        _debug('Zip file location: ', zipFileLocation);

        return new Promise((res, rej) => {
            if (context.opts.useS3) {
                _debug('Uploading target file to S3 bucket: ', context.opts.useS3);
                // upload to S3 in order to avoid timeout issues for too large artifacts
                const filename = zipFileLocation.substring(zipFileLocation.lastIndexOf('/') + 1);
                const s3Uri = `s3://${context.opts.useS3}/_lambda-updater/${filename}`;
                _getCmdPromise(`aws s3 cp ${zipFileLocation} ${s3Uri}`).then(() => {
                    res(`_lambda-updater/${filename}`);
                }).catch(rej);
            } else {
                _debug('Directly uploading function code...');
                res(zipFileLocation);
            }
        }).then(zipFileLocation => {
            _debug('Zip file location: ', zipFileLocation);

            if (!path.isAbsolute(zipFileLocation) && !context.opts.useS3) {
                spinner.fail('Path to zip file is relative, but we need an absolute path. Path: ' + zipFileLocation);
                return;
            }

            context.archive = {
                targetType: targetType,
                zipFileLocation: zipFileLocation
            };

            archive.finalize();
        });
    });
}


function getFunctionNames(context) {
    return new Promise((resolve, reject) => {
        // if no function name is provided: use all valid functions which match target type
        // otherwise use provided function name and find physical name

        spinner = ora('Collecting function(s) to update...').start();

        try {
            const promises = [];
            const doc = yaml.safeLoad(fs.readFileSync(context.opts.cfn, 'utf8'), {schema: cfnYamlSchema.CLOUDFORMATION_SCHEMA});

            if (!doc['Resources']) {
                reject('Missing resources section in CloudFormation template.');
                return;
            }

            const tmpFunctions = _getPotentialFunctionNames(doc, context.opts.funcName);

            for (let i = 0; i < tmpFunctions.length; i++) {
                const func = tmpFunctions[i];

                // consider that also 'normal' resources are defined in a CF file, so check that properties exist!
                const properties = doc['Resources'][func] && doc['Resources'][func].Properties;
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
            spinner.fail('Something failed when collecting function(s) to update. Please use the debug flag for further information.');
            _debug('Error when collecting functions: ', e);
            reject(e);
        }
    });
}


function updateFunctions(context) {
    return new Promise((resolve, reject) => {
        const functions = context.functions;
        _debug('Collected function names: ', functions);

        spinner = ora(`Updating function(s)...`).start();

        const updates = [];

        for (let i = 0; i < functions.length; i++) {
            let functionName = functions[i];
            if (functionName) {
                let cmd = `aws lambda update-function-code --function-name ${functionName}`;
                if (context.opts.useS3) {
                    cmd += ` --s3-bucket ${context.opts.useS3} --s3-key ${context.archive.zipFileLocation}`;
                } else {
                    cmd += ` --zip-file fileb://${context.archive.zipFileLocation}`;
                }
                updates.push(_getCmdPromise(cmd, functionName));
            } else {
                _debug('Ignoring function name, because it is undefined.');
            }
        }

        Promise.all(updates).then(updatedFunctions => {
            spinner.succeed(`Updated ${updatedFunctions.length} function(s):  ${updatedFunctions}`);
            resolve();
        }).catch(reject);
    });
}


///// === HELPER === /////

function _getCmdPromise(cmd, resolveObj) {
    _debug('Executing command: ', cmd);
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err) {
                reject(`Error occurred while executing command "${cmd}" : ${err}`);
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
    const tmpFunctions = [];
    if (!funcName) {
        tmpFunctions.push(...Object.keys(doc['Resources']));
    } else if (doc['Resources'][funcName]) {
        tmpFunctions.push(funcName);
    } else {
        _debug(`Function name ${funcName} not found in CloudFormation resources.`);
    }
    _debug('Found potential resources in YAML file: ', tmpFunctions);
    return tmpFunctions;
}


function _debug(message, object) {
    if (context.opts.debug) {
        console.log("[DEBUG] " + message, JSON.stringify(object));
    }
}
