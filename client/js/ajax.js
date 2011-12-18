"use strict";

// All our handlers for action events
// req events are handled seperately, as we only care about them if they
// are on the top of the log. See handleResponseJson().
var handlers = {
    "joined"              : handle_joined,
    "resources_gained"    : handle_resources_gained,
    "hexes_placed"        : handle_hexes_placed,
    "settlement_built"    : handle_settlement_built,
    "settlement_upgraded" : handle_settlement_upgraded,
    "road_built"          : handle_road_built
}

var req_handlers = {
    "req_turn"            : handle_req_turn,
    "req_setup"           : handle_req_setup
}


function promptSettlement() {
    var dfd = $.Deferred();

    var valid = getValidSettlementPlaces();

    for (var x in valid) {
        drawSettlementDetector(stage, valid[x], gameboard.users[userID].color).
            then(settlementChosen)
    }

    function settlementChosen(p) {
        stage.removeAll();
        dfd.resolve(p)
    }

    return dfd.promise();
}

//if p is passed, allow only roads from position p
function promptRoad(p) {
    var dfd = $.Deferred();

    var valid;

    if (p) {
        valid = getRoadsFromVertex(p);
    }
    else {
        valid = getValidRoadPlaces();
    }

    for (var i in valid) {
        drawRoadDetector(stage, valid[i]).then(roadChosen);
    }

    function roadChosen(p) {
        stage.removeAll();
        dfd.resolve(p);
    }

    return dfd.promise();
}


function promptUpgradeSettlement() {
    var valid = getValidCityPlaces();

    for (var v in valid) {
        drawCityDetector(starge, valid[v]);
    }
}

function name(user) {
    return user == userID ? "You" : ("Player " + user);
}

function handle_joined(log_entry) {
    var user = {};
    user.id = log_entry.user

    gameboard.scores[user.id] = 0;
    user.color = usercolors.pop();
    gameboard.users[log_entry.user] = user;

    sendToTicker(name(user.id) + " joined!");
}

function handle_road_built(log_entry) {
    insertRoad(log_entry.user, log_entry.vertex1, log_entry.vertex2);

    sendToTicker(name(log_entry.user) + " built a road!");
}

function handle_resources_gained(log_entry) {
    var cards = log_entry.cards;

    cards.forEach(
        function(card) {
            gameboard.cards[cardNames[card[1]]] += card[0];
        }
    );

    var message = name(log_entry.user);

    function format_single(card) {
        return card[0] + " " + cardNames[card[1]];
    }

    message += " got";


    if(cards.length > 0) {
        message += " " + format_single(cards[0]);
    }

    for(var i = 1; i < cards.length - 1; i++) {
        message += ", " + format_single(cards[i]);
    }

    if(cards.length > 1) {
        if(cards.length >= 3) message += ", and";
        else message += " and"

        message += " " + format_single(cards[cards.length - 1]);
    }

    console.log(gameboard.cards);

    drawResourceCounters();

    sendToTicker(message);
}

function handle_req_setup(log_entry) {
    var settlement;

    promptSettlement().done(gotSettlement)

    function gotSettlement(p) {
        settlement = p;
        drawSettlement(p, gameboard.users[userID].color);
        promptRoad(p).done(gotRoad);
    }

    function gotRoad(r) {
        r.user = userID;
        drawRoad(r);

        //The roadto is the one that doesn't equal the settlement
        var roadto = r.vertex1 != settlement ? r.vertex1 : r.vertex2
        makeSetupRequest(settlement, roadto);
    }

    function makeSetupRequest(settlement, roadto) {
        makeAjaxRequest("/setup",
                    "?game=" + gameID
                    + "&settlement=" + settlement
                    + "&roadto=" + roadto,
                    function(json) {}
                   );
    }
}

function handle_hexes_placed(log_entry) {
    sendToTicker("Initializing the board...");
    initBoard(log_entry.args);
}

function handle_settlement_built(log_entry) {
    // update score:
    gameboard.scores[log_entry.user] = log_entry.score;

    sendToTicker(name(log_entry.user) + " built a settlement!");
    // TODO: register the settlement build in our global gamestate model
    insertSettlement(log_entry.user, decompress(log_entry.vertex));
    drawSettlement(log_entry.vertex, gameboard.users[log_entry.user].color);
}

function handle_settlement_upgraded(log_entry) {
    sendToTicker(name(log_entry.user) + " upgraded a settlement!");

}

function handle_req_turn(log_entry) {
    sendToTicker(name(log_entry.user) + " rolled a " + log_entry.roll);
}



// The result of the ajax request will json which is then passed to
// the given callback func.
function makeAjaxRequest(url, params, callbackFunc) {
    var xmlhttp;
    xmlhttp = new XMLHttpRequest();

    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {

            console.log("Server Response: " + xmlhttp.responseText);

            callbackFunc(xmlhttp.responseText);
        }
    }

    console.log("Client Request: " + url + params);
    xmlhttp.open("GET", url + params, true);
    xmlhttp.send();
}


function handleResponseJson(json) {
    var myJson = JSON.parse(json);


    window.img = new Image();
    img.onload = function() {


        if(myJson.log && myJson.sequence && myJson.log.length > 0) {

            // update our sequence number
            sequenceNum = myJson.sequence;

            // take care of everything else
            var log = myJson.log;

            for(var x = 0; x < myJson.log.length; x++) {
                if (handlers[log[x].action]) {
                    handlers[log[x].action](log[x]);
                }
            }

            var top = myJson.log[myJson.log.length - 1];

            // handle req_handlers if need be
            if (req_handlers[top.action]) {

                updatePlayerDisplay(top.user);
                window.currentUserID = top.user;

                if (top.user == userID) {
                    req_handlers[top.action](top);
                }
            }

            updateClient();

        }
        else {
            console.log("Malformed json returned");

            setTimeout("updateClient()",3000);
            // stuff is really messed up, so go ahead and reload the page
            //window.location.reload();
        }

    }

    img.src = IMAGE_SOURCE;


}

function joinGame() {
    makeAjaxRequest(HOSTNAME + "/join_game", "?game=" + gameID,
                    function(json) {updateClient();});

}


function updateClient() {
    makeAjaxRequest(HOSTNAME + "/get_log",
                    "?sequence=" + sequenceNum
                    + "&game=" + gameID,
                    handleResponseJson);
}

// currently a huge hack, just so we can get the starting board layout.
function startGameRequest() {

    var create_game_callback = function(json) {
        window.gameID = parseInt(json);
        console.log("created new game with gameID: " + gameID);
        sendToTicker("New game created!");
        sendToTicker("Waiting for players...");

        window.location = HOSTNAME + "/#" + gameID;

        updateClient();
    }

    makeAjaxRequest(HOSTNAME + "/create_game", "",
                   create_game_callback);
}



