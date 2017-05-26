#!/usr/bin/env node

const opts = require('minimist')(process.argv.slice(2));
const ora = require('ora');
const zip = require('adm-zip')();
const yaml = require('js-yaml');

const fs = require('fs');
const exec = require('child_process').exec;
const path = require('path');

const cfn = opts.cfn;
const stack = opts.stack;
const target = opts.target;
const funcName = opts.functionName;

if (!cfn || !stack || !target) {
    console.log('Usage: lambda-updater --cfn path --stack stack-name --target fileOrJar [--functionName name]');
    return;
}

let spinner = ora('Zipping files...').start();


///// 1. Zip file if necessary

let targetType = '';
let zipFileLocation = '';
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
    zip.addLocalFile(target);
    zip.writeZip(zipFileLocation);
}

if (!path.isAbsolute(zipFileLocation)) {
    spinner.fail('Path to zip file is relative, but we need an absolute path. Path: ', zipFileLocation);
    return;
}

spinner.succeed('Zipped file.');


///// 2. Get physical function names.

// if no function name is provided: use all valid functions which match target type
// otherwise use provided function name and find physical name

spinner = ora('Collecting function(s) to update...').start();

let promises = [];

try {
    const doc = yaml.safeLoad(fs.readFileSync(cfn, 'utf8'));
    let tmpFunctions = [];

    if (!funcName) {
        tmpFunctions = Object.keys(doc['Resources']);
    } else {
        tmpFunctions = [funcName];
    }

    for (let i = 0; i < tmpFunctions.length; i++) {
        const func = tmpFunctions[i];

        if (doc['Resources'][func].Properties.Runtime.indexOf(targetType) > -1) {
            const cmd = `aws cloudformation describe-stack-resources --stack-name ${stack} --logical-resource-id ${func} --query "StackResources[].PhysicalResourceId" --output text`;
            promises.push(getCmdPromise(cmd));
        }
    }

} catch (e) {
    spinner.fail('Something failed when collecting function(s) to update.');
    console.log('Error: ', e);
    return;
}

if (promises.length === 0) {
    spinner.fail('No function(s) found for an update.');
    return;
}


///// 3. Update function code for each function

Promise.all(promises).then(data => {
    spinner.succeed(`Found ${promises.length} function(s) to update.`);
    spinner = ora(`Updating ${data.length} function(s)...`).start();

    let updates = [];

    for (let i = 0; i < data.length; i++) {
        const cmd = `aws lambda update-function-code --function-name ${data[i]} --zip-file fileb://${zipFileLocation}`;
        updates.push(getCmdPromise(cmd, data[i]));
    }

    return Promise.all(updates);
}).then(updatedFunctions => {
    spinner.succeed(`Updated function(s):  ${updatedFunctions}`);
}).catch(err => {
    spinner.fail('Error happened while updating function(s).');
    console.log('', err);
});



///// === HELPER === /////

function getCmdPromise(cmd, resolveObj) {
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err) {
                reject(`Error while executing command: "${cmd}"`);
            } else if (!resolveObj && stdout) {
                if (stdout.indexOf('\n') > -1) {
                    resolve(stdout.substring(0, stdout.indexOf('\n')));
                } else {
                    resolve(stdout);
                }
            } else if(resolveObj) {
                resolve(resolveObj);
            } else {
                resolve();
            }
        });
    });
}