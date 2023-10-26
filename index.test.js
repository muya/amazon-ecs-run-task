const run = require('.');
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

jest.mock('@actions/core');
jest.mock('fs');

const mockEcsRegisterTaskDef = jest.fn();
const mockEcsDescribeTasks = jest.fn();
const mockRunTasks = jest.fn();
const mockEcsWaiter = jest.fn();
jest.mock('aws-sdk', () => {
    return {
        config: {
            region: 'fake-region'
        },
        ECS: jest.fn(() => ({
            registerTaskDefinition: mockEcsRegisterTaskDef,
            describeTasks: mockEcsDescribeTasks,
            runTask: mockRunTasks,
            waitFor: mockEcsWaiter
        }))
    };
});

describe('Deploy to ECS', () => {

    beforeEach(() => {
        jest.clearAllMocks();

        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json')                      // task-definition
            .mockReturnValueOnce('cluster-789')                               // cluster
            .mockReturnValueOnce('1')                                         // count
            .mockReturnValueOnce('amazon-ecs-run-task-for-github-actions')    // started-by
            .mockReturnValueOnce('false')                                     // wait-for-finish
            .mockReturnValueOnce('30')                                        // wait-for-minutes
            .mockReturnValueOnce('subnet-123,subnet-456')                     // subnets
            .mockReturnValueOnce('sg-123,sg-456')                             // security-groups
            .mockReturnValueOnce('FARGATE')                                   // launch-type
            .mockReturnValueOnce('') // capacity-provider-strategy
        ;

        process.env = Object.assign(process.env, { GITHUB_WORKSPACE: __dirname });

        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            if (pathInput == path.join(process.env.GITHUB_WORKSPACE, 'task-definition.json')) {
                return JSON.stringify({ family: 'task-def-family' });
            }

            throw new Error(`Unknown path ${pathInput}`);
        });

        //runTask
        //describeTask

        mockEcsRegisterTaskDef.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({ taskDefinition: { taskDefinitionArn: 'task:def:arn:task-definition/task-def-family:1' } });
                }
            };
        });

        mockEcsDescribeTasks.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        tasks: [
                            {
                                containers: [
                                    {
                                        lastStatus: "RUNNING",
                                        exitCode: 0,
                                        reason: '',
                                        taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                    }
                                ],
                                desiredStatus: "RUNNING",
                                lastStatus: "RUNNING",
                                taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                            }
                         ]
                    });
                }
            };
        });

        mockRunTasks.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        tasks: [
                            {
                                containers: [
                                    {
                                        lastStatus: "RUNNING",
                                        exitCode: 0,
                                        reason: '',
                                        taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                    }
                                ],
                                desiredStatus: "RUNNING",
                                lastStatus: "RUNNING",
                                taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                // taskDefinitionArn: "arn:aws:ecs:<region>:<aws_account_id>:task-definition/amazon-ecs-sample:1"
                            }
                         ]
                    });
                }
            };
        });

        mockEcsWaiter.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });
    });

    test('registers the task definition contents and runs the task', async () => {
        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toBeCalledWith('task-definition-arn', 'task:def:arn:task-definition/task-def-family:1');
        expect(core.setOutput).toBeCalledWith('task-definition-family-and-revision', 'task-def-family:1');
        expect(mockRunTasks).toHaveBeenNthCalledWith(1, {
            cluster: 'cluster-789',
            taskDefinition: 'task:def:arn:task-definition/task-def-family:1',
            count: '1',
            startedBy: 'amazon-ecs-run-task-for-github-actions',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: ['subnet-123', 'subnet-456'],
                    securityGroups: ['sg-123', 'sg-456'],
                    assignPublicIp: 'DISABLED'
                }
            },
            launchType: 'FARGATE'
        });
        expect(mockEcsWaiter).toHaveBeenCalledTimes(0);
        expect(core.setOutput).toBeCalledWith('task-arn', ['arn:aws:ecs:fake-region:account_id:task/arn']);
    });

    test('registers the task definition contents and waits for tasks to finish successfully', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json')                      // task-definition
            .mockReturnValueOnce('cluster-789')                               // cluster
            .mockReturnValueOnce('1')                                         // count
            .mockReturnValueOnce('amazon-ecs-run-task-for-github-actions')    // started-by
            .mockReturnValueOnce('true')                                      // wait-for-finish
            .mockReturnValueOnce('')                                          // capacity-provider-strategy
        ;

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toBeCalledWith('task-definition-arn', 'task:def:arn:task-definition/task-def-family:1');
        expect(core.setOutput).toBeCalledWith('task-definition-family-and-revision', 'task-def-family:1');
        expect(mockEcsDescribeTasks).toHaveBeenNthCalledWith(1, {
            cluster: 'cluster-789',
            tasks:  ['arn:aws:ecs:fake-region:account_id:task/arn']
        });

        expect(mockEcsWaiter).toHaveBeenCalledTimes(1);
        expect(core.setOutput).toBeCalledWith('task-arn', ['arn:aws:ecs:fake-region:account_id:task/arn']);

        expect(core.info).toBeCalledWith("All tasks have exited successfully.");
    });

    test('cleans null keys out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "ipcMode": null, "family": "task-def-family" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('cleans empty arrays out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "tags": [], "family": "task-def-family" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('cleans empty strings and objects out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return `
            {
                "memory": "",
                "containerDefinitions": [ {
                    "name": "sample-container",
                    "logConfiguration": {},
                    "repositoryCredentials": { "credentialsParameter": "" },
                    "command": [
                        ""
                    ],
                    "environment": [
                        {
                            "name": "hello",
                            "value": "world"
                        },
                        {
                            "name": "",
                            "value": ""
                        }
                    ],
                    "secretOptions": [ {
                        "name": "",
                        "valueFrom": ""
                    } ],
                    "cpu": 0,
                    "essential": false
                } ],
                "requiresCompatibilities": [ "EC2" ],
                "family": "task-def-family"
            }
            `;
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, {
            family: 'task-def-family',
            containerDefinitions: [
                {
                    name: 'sample-container',
                    cpu: 0,
                    essential: false,
                    environment: [{
                        name: 'hello',
                        value: 'world'
                    }]
                }
            ],
            requiresCompatibilities: [ 'EC2' ]
        });
    });

    test('cleans invalid keys out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "compatibilities": ["EC2"], "taskDefinitionArn": "arn:aws...:task-def-family:1", "family": "task-def-family", "revision": 1, "status": "ACTIVE" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('error is caught if task def registration fails', async () => {
        mockEcsRegisterTaskDef.mockImplementation(() => {
            throw new Error("Could not parse");
        });

        await run();

        expect(core.setFailed).toHaveBeenCalledTimes(2);
        expect(core.setFailed).toHaveBeenNthCalledWith(1, 'Failed to register task definition in ECS: Could not parse');
        expect(core.setFailed).toHaveBeenNthCalledWith(2, 'Could not parse');
    });
    test('error is caught if capacity provider strategy param parsing fails', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json')                      // task-definition
            .mockReturnValueOnce('cluster-789')                               // cluster
            .mockReturnValueOnce('1')                                         // count
            .mockReturnValueOnce('amazon-ecs-run-task-for-github-actions')    // started-by
            .mockReturnValueOnce('false')                                     // wait-for-finish
            .mockReturnValueOnce('30')                                        // wait-for-minutes
            .mockReturnValueOnce('subnet-123,subnet-456')                     // subnets
            .mockReturnValueOnce('sg-123,sg-456')                             // security-groups
            .mockReturnValueOnce('FARGATE')                                   // launch-type
            .mockReturnValueOnce('not-a-json');                               // capacity-provider-strategy

        await run();

        expect(core.setFailed).toHaveBeenCalledTimes(2);
        expect(core.setFailed).toHaveBeenNthCalledWith(1, 'Failed to parse capacity provider strategy definition: Unexpected token o in JSON at position 1');
        expect(core.setFailed).toHaveBeenNthCalledWith(2, 'Unexpected token o in JSON at position 1');
    });
});
