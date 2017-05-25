# lambda-updater
A small CLI tool to update one or more [AWS Lambda](https://aws.amazon.com/lambda/) functions from a
[AWS CloudFormation](https://aws.amazon.com/cloudformation/) template.
This is useful if you have a huge CloudFormation stack, but don't want to re-deploy the whole stack
just because you've added one line in a Lambda function. Use this to quickly upload a new version of your code.

## Install

### npm
```
npm install -g lambda-updater
```

### yarn

```
yarn global lambda-updater
```

## Usage

Before you use *lambda-updater*, make sure that your CloudFormation stack exists.

After that, just use the following command and all Java or NodeJS functions from your CloudFormation template
get updated:

```
lambda-updater --cfn path --stack stack-name --target jsOrJarFile [--functionName name]
```

**--cfn** the relative path to your CloudFormation template

**--stack** the stack name for your CloudFormation template

**--target** a JS or JAR file containing your function code; just the functions matching the target type will be
updated (might be useful if you're using Java and NodeJS functions in one project)

**--functionName** optional: if you just want to update one single function, provide the logical function name

### Note
The logical function name is what you define in your CloudFormation template. Example:
```
AWSTemplateFormatVersion: '2010-09-09'

Resources:
  YourLogicalFunctionName:
    Type: AWS::Serverless::Function
    Properties:
      # ...
```


## Author

[Sebastian Hesse](https://www.sebastianhesse.de)


## License

MIT License

Copyright (c) 2017 [Sebastian Hesse](https:///www.sebastianhesse.de)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.