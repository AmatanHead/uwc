/* Message specification:
 *
 * r: round id, a unique identifier for a single wave.
 * t: type of the algorithm, can be 'message', 'min', 'graph'.
 *
 *
 * For 'message' algorithm:
 *
 * sender: id of the original sender
 * message: message
 *
 *
 * For 'min' algorithm:
 *
 * mt: message type, can be 'request' or 'response'.
 * value: a minimal value known to the sender. May be null, than client should ignore the sender.
 * client: who owns that minimal value.
 *
 *
 * * For 'graph' algorithm:
 *
 * mt: message type, can be 'request' or 'response'.
 * value: a part of graph known to the sender.
 *
 */

function broadcast(data, connections, parentId) {
    const values = connections.values();
    for (let i = 0; i < values.length; i += 1) {
        if (values[i].open && values[i].peer !== parentId) {
            values[i].send(data);
        }
    }
}


function GraphAlgorithm(parentConnection, data, connections, chat) {
    const isInitializer = parentConnection === null;

    if (isInitializer) { chat.displayHtml('Requesting graph...'); }

    broadcast(data, connections, parentConnection === null ? null : parentConnection.peer);

    let responsesToGo = chat.countActiveConnections() - !isInitializer;

    const value = {};
    value[chat.peer.id] = [];
    connections.each((connection) => { if (connection.open) { value[chat.peer.id].push(connection.peer); } });

    function displayGraph() {
        const nodes = [];
        const links = [];

        console.log(value);

        for (let src in value) {
            if (!value.hasOwnProperty(src)) { continue; }
            nodes.push({id: src});
            for (let i = 0; i < value[src].length; i += 1) {
                links.push({source: src, target: value[src][i]});
            }
        }

        console.log(nodes, links);

        chat.displayHtml(`<svg width="400" height="200" id="G${data.r}"></svg>`);
        const svg = d3.select(`#G${data.r}`);
        const width = +svg.attr('width');
        const height = +svg.attr('height');

        const simulation = d3.forceSimulation()
            .force('link', d3.forceLink().id(d => d.id))
            .force('charge', d3.forceManyBody())
            .force('center', d3.forceCenter(width / 2, height / 2));

        const link = svg.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(links)
            .enter().append('line');

        const node = svg.append('g')
            .attr('class', 'nodes')
            .selectAll('circle')
            .data(nodes)
            .enter().append('g')
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        node.append('circle')
            .attr('r', 2.5)
            .classed('nodes-you', (d) => d.id === chat.peer.id );

        node.append('text')
            .attr('x', 5)
            .attr('y', 3)
            .text(d => d.id);

        simulation
            .nodes(nodes)
            .on('tick', ticked);

        simulation
            .force('link')
            .links(links);

        function ticked() {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('transform', d => `translate(${d.x}, ${d.y})`);
        }

        function dragstarted(d) {
            if (!d3.event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(d) {
            d.fx = d3.event.x;
            d.fy = d3.event.y;
        }

        function dragended(d) {
            if (!d3.event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
    }

    function maybeSendResult() {
        if (responsesToGo === 0) {
            if (isInitializer) {
                displayGraph();
            } else {
                parentConnection.send({r: data.r, t: data.t, mt: 'response', value: value})
            }
        }
    }

    this.onMessage = (data, connection) => {
        if (data.mt === 'response') {
            responsesToGo -= 1;
            if (data.value !== null) {
                for (let id in data.value) {
                    if (data.value.hasOwnProperty(id)) {
                        value[id] = data.value[id];
                    }
                }
            }
            maybeSendResult();
        } else {
            connection.send({r: data.r, t: data.t, mt: 'response', value: null});
        }
    };

    maybeSendResult();
}


function MinAlgorithm(parentConnection, data, connections, chat) {
    const isInitializer = parentConnection === null;

    if (isInitializer) { chat.displayHtml('Requesting min...'); }

    broadcast(data, connections, parentConnection === null ? null : parentConnection.peer);

    let responsesToGo = chat.countActiveConnections() - !isInitializer;

    let value = chat.value;
    let client = chat.peer.id;

    function maybeSendResult() {
        if (responsesToGo === 0) {
            if (isInitializer) {
                chat.displayHtml(`<b>The minimal value is ${value}, owned by ${client}</b>`);
            } else {
                parentConnection.send({r: data.r, t: data.t, mt: 'response', value: value, client: client})
            }
        }
    }

    this.onMessage = (data, connection) => {
        if (data.mt === 'response') {
            responsesToGo -= 1;
            if (data.value !== null && data.value < value) {
                value = data.value;
                client = data.client;
            }
            maybeSendResult();
        } else {
            connection.send({r: data.r, t: data.t, mt: 'response', value: null, client: null});
        }
    };

    maybeSendResult();
}


function MessageAlgorithm(parentConnection, data, connections, chat) {
    chat.displayMessage(data.sender, data.message);
    broadcast(data, connections, parentConnection === null ? null : parentConnection.peer);
    this.onMessage = (data, connection) => {};
}


function Chat(messageInput, messageButton, messagesFeed) {
    const self = this;

    const apikey = '8e675y1tl0nyu8fr';

    const set_n_re = /^\s*\/set\s+(-?\d+)\s*$/;
    const min_re = /^\s*\/min\s*$/;
    const graph_re = /^\s*\/graph\s*$/;
    const debug_re = /^\s*\/debug\s*$/;

    self.peer = new Peer({
        key: apikey,
        debug: 3,
        secure: true,
        logFunction: (a, b, c) => {
            self.displayDebug(`${a || ''} ${b || ''} ${c || ''}`);
        }
    });

    self.value = 0;

    const connections = d3.map();
    let round = 0;
    let rounds = {};

    self.doScroll = (height) => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - height - 50) {
            window.scrollTo(0, document.body.scrollHeight);
        }
    };

    self.displayMessage = (sender, message) => {
        messagesFeed.append('hr');
        const element = messagesFeed.append('p');
        if (sender !== null) {
            const is_you = sender === self.peer.id;
            const text = sender + ': ';
            element.append('span').classed('from-text', true).classed('from-you', is_you).text(text);
        }
        const span = element.append('span').text(message);
        span.html(Autolinker.link(span.html().replace(/\n/g, '<br>')));
        self.doScroll(element.node().offsetHeight);
    };

    self.displayHtml = html => {
        messagesFeed.append('hr');
        const element = messagesFeed.append('p').html(html);
        self.doScroll(element.node().offsetHeight);
    };

    self.displayDebug = message => {
        messagesFeed.append('hr').classed('debug', true);
        const element = messagesFeed.append('p').classed('debug', true).html(message);
        self.doScroll(element.node().offsetHeight);
    };

    self.displayError = message => {
        messagesFeed.append('hr').classed('error', true);
        const element = messagesFeed.append('p').classed('error', true).html(message);
        self.doScroll(element.node().offsetHeight);
    };

    self.connect = id => {
        if (id === self.peer.id) {
            self.displayHtml('You cannot connect to yourself.')
        } else {
            self.setupNewConnection(self.peer.connect(id));
        }
    };

    self.setupNewConnection = (connection) => {
        const id = connection.peer;

        if (connections.has(id)) {
            connections.get(id).close();
            connections.remove(id);
            self.displayHtml(`Reconnecting to ${id}...`);
        } else {
            self.displayHtml(`Connecting to ${id}...`);
        }

        connections.set(id, connection);

        connection.on('data', (data) => {
            if (rounds.hasOwnProperty(data.r)) {
                rounds[data.r].onMessage(data, connection);
            } else {
                const t = {'message': MessageAlgorithm, 'min': MinAlgorithm, 'graph': GraphAlgorithm}[data['t']];
                rounds[data.r] = new t(connection, data, connections, self);
            }
        });
        connection.on('open', () => { self.displayHtml(`Connected to ${id}`); });
        connection.on('close', () => { self.displayHtml(`Disconnected from ${id}`); });
        connection.on('error', () => { self.displayError(`Error when working with ${id}`); });
    };

    self.countActiveConnections = () => {
        if (connections.empty()) { return 0 }
        const values = connections.values();
        let count = 0;
        for (let i = 0; i < values.length; i += 1) { if (values[i].open) { count += 1; } }
        return count;
    };

    function processMessage() {
        const message = messageInput.node().value;

        if (!message.replace(/\s/g, '').length) { return; }

        const set_n_match = message.match(set_n_re);
        const min_match = message.match(min_re);
        const graph_match = message.match(graph_re);
        const debug_match = message.match(debug_re);

        round += 1;
        const r = `${self.peer.id}__${round}`;

        if (set_n_match) {
            const oldValue = self.value;
            self.value = parseInt(set_n_match[1]);
            self.displayHtml(`Changed value: ${oldValue} -> ${self.value}`);
        } else if (min_match) {
            const data = {r: r, t: 'min'};
            rounds[r] = new MinAlgorithm(null, data, connections, self)
        } else if (graph_match) {
            const data = {r: r, t: 'graph'};
            rounds[r] = new GraphAlgorithm(null, data, connections, self)
        } else if (debug_match) {
            const body = d3.select(document.body);
            body.classed('show-debug', !body.classed('show-debug'));
        } else {
            if (!self.countActiveConnections()) {
                self.displayHtml('No active connections found. Please, connect to somebody using the input above.');
            } else {
                const data = {r: r, t: 'message', sender: self.peer.id, message: message};
                rounds[r] = new MessageAlgorithm(null, data, connections, self)
            }
        }

        messageInput.node().value = '';
        messageInput.node().focus();
    }

    messageButton.on('click', processMessage);
    messageInput.on('keyup', () => { if (d3.event.ctrlKey && d3.event.keyCode === 13) { processMessage(); } });

    self.peer.on('open', (id) => { self.displayHtml(`Your id is ${id}`); });
    self.peer.on('connection', (connection) => { self.setupNewConnection(connection); });
    self.peer.on('error', (err) => { self.displayError(err); })
}
