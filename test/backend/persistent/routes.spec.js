import fetch from 'node-fetch';
import assert from 'assert';
import Server from '../../../backend/routes.js';
import {
    getCredentials,
    getSanitizedCredentials,
    saveCredential
} from '../../../backend/persistent/Credentials.js';
import {
    CREDENTIALS_PATH,
    QUERIES_PATH,
    SETTINGS_PATH
} from '../../../backend/utils/homeFiles.js';
import {getSetting, saveSetting}  from '../../../backend/Settings.js';
import fs from 'fs';
import {
    createGrid,
    configuration,
    sqlCredentials,
    elasticsearchCredentials,
    publicReadableS3Credentials,
    apacheDrillCredentials,
    apacheDrillStorage
} from '../utils.js';


import {dissoc, merge} from 'ramda';

// Shortcuts
function GET(path) {

    return fetch(`http://localhost:9494/${path}`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    });
}

function POST(path, body = {}) {
    return fetch(`http://localhost:9494/${path}`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : null
    });
}

function DELETE(path) {

    return fetch(`http://localhost:9494/${path}`, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    });
}


let queryObject;
let server;
let credentialId;
describe('Server', function () {
    beforeEach(() => {
        server = new Server();
        server.start();

        // Save some credentials to the user's disk
        try {
            fs.unlinkSync(CREDENTIALS_PATH);
        } catch (e) {}
        try {
            fs.unlinkSync(QUERIES_PATH);
        } catch (e) {}
        try {
            fs.unlinkSync(SETTINGS_PATH);
        } catch (e) {}

        credentialId = saveCredential(sqlCredentials);
        queryObject = {
            fid: 'chris:10',
            uids: ['asd', 'xyz'],
            refreshInterval: 5,
            query: 'SELECT * FROM ebola_2014 LIMIT 1',
            credentialId: credentialId
        };

    });

    afterEach(() => {
        server.close();
        server.queryScheduler.clearQueries();
    });


    it ('responds on a ping', function(done) {
        GET('ping')
        .then(() => done())
        .catch(done);
    });

    // OAuth
    it('returns 200 on loading the oauth page', function(done) {
        GET('oauth2/callback')
        .then(res => {
            assert.equal(res.status, 200);
            done();
        })
        .catch(done);
    })


    it('oauth - saves oauth access token with a username if valid', function(done) {
        /*
         * This is a real live access token associated with
         * the user account plotly-database-connector on
         * https://plot.ly.
         *
         * This token is generated by visiting
         * https://plot.ly/o/authorize/?response_type=token&client_id=5sS4Kxx8lqcprixXHKAaCGUCXqPCEVLnRNTGeNQU&redirect_uri=http://localhost:9494/oauth2/callback
         * in your web browser.
         */
        assert.deepEqual(
            getSetting('USERS'),
            []
        );
        const access_token = '9DGsJcSoB6s08vVNQJ5u7C1d8TfIo6';
        POST('oauth-token', {
            access_token
        })
        .then(res => res.json().then(json => {
            assert.deepEqual(json, {});
            assert.equal(res.status, 201);
            assert.deepEqual(
                getSetting('USERS'),
                [{username: 'plotly-database-connector', accessToken: access_token}]
            );

            // We can save it again and we'll get a 200 instead of a 201
            POST('oauth-token', {access_token})
            .then(res => res.json().then(json => {
                assert.deepEqual(json, {});
                assert.equal(res.status, 200);
                done();
            })).catch(done);
        }))
        .catch(done);
    });

    it('oauth - saving an access token that is not associated with a user account will fail with a 500 level error', function(done) {
        const access_token = 'lah lah lemons';
        POST('oauth-token', {access_token})
        .then(res => res.json().then(json => {
            assert.deepEqual(json, {
                error: {
                    message: 'User was not found.'
                }
            });
            assert.equal(res.status, 500);
            assert.deepEqual(
                getSetting('USERS'),
                []
            );
            done();
        })).catch(done);
    });

    // One Time SQL Queries
    it('runs a SQL query', function(done) {
        this.timeout(5000);
        POST(`query/${credentialId}`, {
            query: 'SELECT * FROM ebola_2014 LIMIT 1'
        })
        .then(res => res.json())
        .then(response => {
            assert.deepEqual(
                response.rows,
                [['Guinea', 3, 14, '9.95', '-9.7', '122']]
            );
            assert.deepEqual(
                response.columnnames,
                ['country', 'month', 'year', 'lat', 'lon', 'value']
            );
            done();
        }).catch(done);
    });

    it('fails when the SQL query contains a syntax error', function(done) {
        this.timeout(60 * 1000);
        POST(`query/${credentialId}`, {
            query: 'SELECZ'
        })
        .then(res => res.json().then(json => {
            assert.equal(res.status, 400);
            assert.deepEqual(
                json,
                {error: {message: 'syntax error at or near "SELECZ"'}}
            );
            done();
        }))
        .catch(done);
    });

    it('succeeds when SQL query returns no data', function(done) {
        this.timeout(60 * 1000);
        POST(`query/${credentialId}`, {
            query: 'SELECT * FROM ebola_2014 LIMIT 0'
        })
        .then(res => res.json().then(json => {
            assert.equal(res.status, 200);
            assert.deepEqual(
                json,
                {
                    columnnames: [],
                    rows: [[]],
                    nrows: 0,
                    ncols: 0
                }
            );
            done();
        }))
        .catch(done);
    });

    // Meta info about the tables
    it('/tables returns a list of tables', function(done) {
        this.timeout(5000);
        POST(`tables/${credentialId}`)
        .then(res => res.json())
        .then(json => {
            assert.deepEqual(
                json,
                [
                    'alcohol_consumption_by_country_2010',
                    'february_aa_flight_paths_2011',
                    'walmart_store_openings_1962_2006',
                    'february_us_airport_traffic_2011',
                    'us_ag_exports_2011',
                    'apple_stock_2014',
                    'usa_states_2014',
                    'ebola_2014',
                    'us_cities_2014',
                    'world_gdp_with_codes_2014',
                    'precipitation_2015_06_30',
                    'weather_data_seattle_2016'
                ]
            );
            done();
        }).catch(done);
    });

    // S3
    it('/s3-keys returns a list of keys', function(done) {
        const s3CredId = saveCredential(publicReadableS3Credentials);

        this.timeout(5000);
        POST(`s3-keys/${s3CredId}`)
        .then(res => res.json())
        .then(files => {
            assert.deepEqual(
                JSON.stringify(files[0]),
                JSON.stringify({
                    "Key":"311.parquet/._SUCCESS.crc",
                    "LastModified":"2016-10-26T03:27:31.000Z",
                    "ETag":'"9dfecc15c928c9274ad273719aa7a3c0"',
                    "Size":8,
                    "StorageClass":"STANDARD",
                    "Owner": {
                        "DisplayName":"chris",
                        "ID":"655b5b49d59fe8784105e397058bf0f410579195145a701c03b55f10920bc67a"
                    }
                })
            );
            done()
        }).catch(done);
    });

    it('/s3-keys fails with the wrong credentials', function(done) {
        const s3CredId = saveCredential({
            dialect: 's3',
            accessKeyId: 'asdf',
            secretAccessKey: 'fdsa'
        });
        POST(`s3-keys/${s3CredId}`)
        .then(res => res.json().then(json => {
            expect.equal(res.status, 400);
            expect.deepEqual(json, {error: {message: 'lah lah lemons'}});
            done();
        }))
        .catch(done);
    });

    it('/query returns data for s3', function(done) {
        const s3CredId = saveCredential(publicReadableS3Credentials);
        this.timeout(5000);
        POST(`query/${s3CredId}`, {query: '5k-scatter.csv'})
        .then(res => res.json().then(json => {
            assert.equal(res.status, 200),
            assert.deepEqual(
                Object.keys(json),
                ['columnnames', 'ncols', 'nrows', 'rows']
            );
            assert.deepEqual(
                rows.slice(0, 3),
                [
                    [1, 2, 3, 4],
                    [10, 20, 30, 40]
                ]
            );
        }));
    });

    // Apache Drill
    it('/apache-drill-storage returns a list of storage items', function(done) {
        const s3CredId = saveCredential(apacheDrillCredentials);

        this.timeout(5000);
        POST(`apache-drill-storage/${s3CredId}`)
        .then(res => res.json())
        .then(storage => {
            assert.deepEqual(
                storage,
                apacheDrillStorage
            );
            done()
        }).catch(done);
    });

    it('/apache-drill-s3-keys returns a list of s3 files', function(done) {
        const s3CredId = saveCredential(apacheDrillCredentials);
        this.timeout(5000);
        POST(`apache-drill-s3-keys/${s3CredId}`)
        .then(res => res.json())
        .then(files => {
            assert.deepEqual(
                JSON.stringify(files[0]),
                JSON.stringify({
                    "Key":"311.parquet/._SUCCESS.crc",
                    "LastModified":"2016-10-26T03:27:31.000Z",
                    "ETag":'"9dfecc15c928c9274ad273719aa7a3c0"',
                    "Size":8,
                    "StorageClass":"STANDARD",
                    "Owner": {
                        "DisplayName":"chris",
                        "ID":"655b5b49d59fe8784105e397058bf0f410579195145a701c03b55f10920bc67a"
                    }
                })
            );
            done()
        }).catch(done);
    });

    // TODO - Fix this test
    it('/query returns a syntax error', function(done) {
        const s3CredId = saveCredential(apacheDrillCredentials);
        this.timeout(5000);
        POST(`query/${credentialId}`, {
            query: 'SELECTZ;'
        })
        .then(res => res.json().then(json => {
            assert.equal(res.status, 400);
            assert.deepEqual(json, {error: {message: 'lah lah lemons'}});
        }));
    });

    // Credentials
    it('saves credentials to a file if they do not exist', function(done) {
        fs.unlinkSync(CREDENTIALS_PATH);
        assert.deepEqual(getCredentials(), []);
        POST('credentials', sqlCredentials)
        .then(res => {
            assert.equal(res.status, 200);
            assert.deepEqual(
                [sqlCredentials],
                getCredentials().map(dissoc('id'))
            );
            done();
        }).catch(done);
    });

    it("doesn't save credentials if they already exist", function(done) {
        POST('credentials', sqlCredentials)
        .then(res => {
            assert.equal(res.status, 409);
            assert.deepEqual(res.credentialId, credentialId);
        });
    });

    it('returns sanitized credentials', function(done) {
        GET('credentials')
        .then(res => {
            assert.equal(res.status, 200);
            return res.json();
        })
        .then(json => {
            assert.deepEqual(
                json.map(dissoc('id')),
                [dissoc('password', sqlCredentials)]
            );
            done();
        }).catch(done);
    });

    it('deletes credentials', function(done) {
        assert.deepEqual(getCredentials().map(dissoc('id')), [sqlCredentials]);
         DELETE(`credentials/${credentialId}`)
        .then(res => {
            assert.equal(res.status, 204);
            assert.deepEqual(getCredentials(), []);
            done();
        }).catch(done);
    });

    it('returns an empty array of credentials', function(done) {
        fs.unlinkSync(CREDENTIALS_PATH);
        GET('credentials')
        .then(res => {
            assert.equal(res.status, 200);
            return res.json();
        })
        .then(json => {
            assert.deepEqual(json, []);
            done();
        }).catch(done);
    });

    // Persistent Queries
    it('registers a query and returns saved queries', function(done) {
        this.timeout(10 * 1000);
        // Verify that there are no queries saved
        GET('queries')
        .then(res => res.json())
        .then(json => {
            assert.deepEqual(json, []);

            // Save a grid that we can update
            return createGrid('test interval');

        })
        .then(res => {
            assert.equal(res.status, 201, 'Grid was created');
            return res.json();
        })
        .then(json => {
            const fid = json.file.fid;
            const uids = json.file.cols.map(col => col.uid);

            queryObject = {
                fid,
                uids,
                refreshInterval: 60,
                credentialId,
                query: 'SELECT * from ebola_2014 LIMIT 2'
            };
            return POST('queries', queryObject);
        })
        .then(res => {
            assert.equal(res.status, 201, 'Query was saved');
            return GET('queries')
        })
        .then(res => res.json())
        .then(json => {
            assert.deepEqual(json, [queryObject]);
        })
        .then(() => done())
        .catch(done);
    });

    it('gets individual queries', function(done) {
        POST('queries', queryObject)
        .then(() => GET(`queries/${queryObject.fid}`))
        .then(res => res.json())
        .then(json => {
            assert.deepEqual(json, queryObject);
            done();
        }).catch(done);
    });

    it('deletes queries', function(done) {
        POST('queries', queryObject)
        .then(() => DELETE(`queries/${queryObject.fid}`))
        .then(res => {
            assert.equal(res.status, 204);
            return GET(`queries/${queryObject.fid}`);
        })
        .then(res => {
            assert.equal(res.status, 404);
            done();
        }).catch(done);
    });

    it('returns 404s when getting queries that don\'t exist', function(done) {
        GET('queries/asdfasdf')
        .then(res => {
            assert.equal(res.status, 404);
            done();
        })
        .catch(done);
    });

    it('returns 404s when deleting queries that don\'t exist', function(done) {
        DELETE('queries/asdfasdf')
        .then(res => {
            assert.equal(res.status, 404);
            done();
        })
        .catch(done);
    });

    it("POST /queries fails when the user's API keys aren't supplied", function(done) {
        this.timeout(2 * 1000);
        saveSetting('USERS', []);
        assert.deepEqual(getSetting('USERS'), []);
        POST('queries', queryObject)
        .then(res => res.json().then(json => {
            assert.equal(res.status, 400);
            assert.deepEqual(json, {error: {message: 'API key was not supplied.'}});
            done();
        })).catch(done);
    });

    it("POST /queries fails when the user's API keys aren't correct", function(done) {
        const creds = [{username: 'chris', apikey: 'lah lah lemons'}];
        saveSetting('USERS', creds);
        assert.deepEqual(getSetting('USERS'), creds);
        POST('queries', queryObject)
        .then(res => res.json().then(json => {
            assert.equal(res.status, 400);
            assert.deepEqual(
                json,
                {error: {message: 'Unauthenticated'}}
            );
            done();
        })).catch(done);
    });

    it("POST /queries fails when it can't connect to the plotly server", function(done) {
        this.timeout(70*1000);
        const nonExistantServer = 'https://plotly.lah-lah-lemons.com';
        saveSetting('PLOTLY_API_DOMAIN', nonExistantServer);
        assert.deepEqual(getSetting('PLOTLY_API_DOMAIN'), nonExistantServer);
        POST('queries', queryObject)
        .then(res => res.json().then(json => {
            assert.equal(res.status, 500);
            assert.deepEqual(
                json,
                {error: {message: 'lah lah lemons'}}
            );
            done()
        })).catch(done);
    });

    it('uncaught exceptions get thrown OK ', function(done){
        this.timeout(3 * 1000);
        POST('_throw')
        .then(res => res.json().then(json => {
            assert.equal(res.status, 500);
            assert.deepEqual(json, {error: {message: 'Yikes - uncaught error'}});
            done();
        })).catch(done);
    });

    it("POST /queries fails when there is a syntax error in the query", function(done) {
        const invalidQueryObject = merge(
            queryObject,
            {query: 'SELECT'}
        );
        POST('queries', invalidQueryObject)
        .then(res => res.json().then(json => {
            assert.equal(res.status, 400);
            assert.deepEqual(
                json,
                {error: {message: 'lah lah lemons'}}
            );
            done();
        })).catch(done);
    });

});
