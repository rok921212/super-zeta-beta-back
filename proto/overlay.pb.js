/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
"use strict";

var $protobuf = require("protobufjs/minimal");

// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
var $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $TypeError = $util.global.TypeError, $Number = $util.global.Number, $isFinite = $util.global.isFinite, $String = $util.global.String, $Boolean = $util.global.Boolean, $Array = $util.global.Array;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.overlay = (function() {

    /**
     * Namespace overlay.
     * @exports overlay
     * @namespace
     */
    var overlay = {};

    overlay.Vec3 = (function() {

        /**
         * Properties of a Vec3.
         * @typedef {Object} overlay.Vec3.$Properties
         * @property {number|null} [x] Vec3 x
         * @property {number|null} [y] Vec3 y
         * @property {number|null} [z] Vec3 z
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Vec3.
         * @memberof overlay
         * @interface IVec3
         * @augments overlay.Vec3.$Properties
         * @deprecated Use overlay.Vec3.$Properties instead.
         */

        /**
         * Shape of a Vec3.
         * @typedef {overlay.Vec3.$Properties} overlay.Vec3.$Shape
         */

        /**
         * Constructs a new Vec3.
         * @memberof overlay
         * @classdesc Represents a Vec3.
         * @constructor
         * @param {overlay.Vec3.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        var Vec3 = function (properties) {
            if (properties)
                for (var keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Vec3 x.
         * @member {number} x
         * @memberof overlay.Vec3
         * @instance
         */
        Vec3.prototype.x = 0;

        /**
         * Vec3 y.
         * @member {number} y
         * @memberof overlay.Vec3
         * @instance
         */
        Vec3.prototype.y = 0;

        /**
         * Vec3 z.
         * @member {number} z
         * @memberof overlay.Vec3
         * @instance
         */
        Vec3.prototype.z = 0;

        /**
         * Creates a new Vec3 instance using the specified properties.
         * @function create
         * @memberof overlay.Vec3
         * @static
         * @param {overlay.Vec3.$Properties=} [properties] Properties to set
         * @returns {overlay.Vec3} Vec3 instance
         * @type {{
         *   (properties: overlay.Vec3.$Shape): overlay.Vec3 & overlay.Vec3.$Shape;
         *   (properties?: overlay.Vec3.$Properties): overlay.Vec3;
         * }}
         */
        Vec3.create = function(properties) {
            return new Vec3(properties);
        };

        /**
         * Encodes the specified Vec3 message. Does not implicitly {@link overlay.Vec3.verify|verify} messages.
         * @function encode
         * @memberof overlay.Vec3
         * @static
         * @param {overlay.Vec3.$Properties} message Vec3 message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Vec3.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.x != null && $Object.hasOwnProperty.call(message, "x") && !$Object.is(message.x, 0))
                writer.uint32(/* id 1, wireType 5 =*/13).float(message.x);
            if (message.y != null && $Object.hasOwnProperty.call(message, "y") && !$Object.is(message.y, 0))
                writer.uint32(/* id 2, wireType 5 =*/21).float(message.y);
            if (message.z != null && $Object.hasOwnProperty.call(message, "z") && !$Object.is(message.z, 0))
                writer.uint32(/* id 3, wireType 5 =*/29).float(message.z);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Vec3 message, length delimited. Does not implicitly {@link overlay.Vec3.verify|verify} messages.
         * @function encodeDelimited
         * @memberof overlay.Vec3
         * @static
         * @param {overlay.Vec3.$Properties} message Vec3 message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Vec3.encodeDelimited = function(message, writer) {
            return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
        };

        /**
         * Decodes a Vec3 message from the specified reader or buffer.
         * @function decode
         * @memberof overlay.Vec3
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {overlay.Vec3 & overlay.Vec3.$Shape} Vec3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Vec3.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            var end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.overlay.Vec3(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 5)
                            break;
                        if (!$Object.is(value = reader.float(), 0))
                            message.x = value;
                        else
                            delete message.x;
                        continue;
                    }
                case 2: {
                        if (wireType !== 5)
                            break;
                        if (!$Object.is(value = reader.float(), 0))
                            message.y = value;
                        else
                            delete message.y;
                        continue;
                    }
                case 3: {
                        if (wireType !== 5)
                            break;
                        if (!$Object.is(value = reader.float(), 0))
                            message.z = value;
                        else
                            delete message.z;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Decodes a Vec3 message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof overlay.Vec3
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {overlay.Vec3 & overlay.Vec3.$Shape} Vec3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Vec3.decodeDelimited = function(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Vec3 message.
         * @function verify
         * @memberof overlay.Vec3
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Vec3.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.x != null && $Object.hasOwnProperty.call(message, "x"))
                if (typeof message.x !== "number")
                    return "x: number expected";
            if (message.y != null && $Object.hasOwnProperty.call(message, "y"))
                if (typeof message.y !== "number")
                    return "y: number expected";
            if (message.z != null && $Object.hasOwnProperty.call(message, "z"))
                if (typeof message.z !== "number")
                    return "z: number expected";
            return null;
        };

        /**
         * Creates a Vec3 message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof overlay.Vec3
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {overlay.Vec3} Vec3
         */
        Vec3.fromObject = function (object, _depth) {
            if (object instanceof $root.overlay.Vec3)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".overlay.Vec3: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var message = new $root.overlay.Vec3();
            if (object.x != null)
                if (!$Object.is($Number(object.x), 0))
                    message.x = $Number(object.x);
            if (object.y != null)
                if (!$Object.is($Number(object.y), 0))
                    message.y = $Number(object.y);
            if (object.z != null)
                if (!$Object.is($Number(object.z), 0))
                    message.z = $Number(object.z);
            return message;
        };

        /**
         * Creates a plain object from a Vec3 message. Also converts values to other types if specified.
         * @function toObject
         * @memberof overlay.Vec3
         * @static
         * @param {overlay.Vec3} message Vec3
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Vec3.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var object = {};
            if (options.defaults) {
                object.x = 0;
                object.y = 0;
                object.z = 0;
            }
            if (message.x != null && $Object.hasOwnProperty.call(message, "x"))
                object.x = options.json && !$isFinite(message.x) ? $String(message.x) : message.x;
            if (message.y != null && $Object.hasOwnProperty.call(message, "y"))
                object.y = options.json && !$isFinite(message.y) ? $String(message.y) : message.y;
            if (message.z != null && $Object.hasOwnProperty.call(message, "z"))
                object.z = options.json && !$isFinite(message.z) ? $String(message.z) : message.z;
            return object;
        };

        /**
         * Converts this Vec3 to JSON.
         * @function toJSON
         * @memberof overlay.Vec3
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Vec3.prototype.toJSON = function() {
            return Vec3.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Vec3
         * @function getTypeUrl
         * @memberof overlay.Vec3
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Vec3.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/overlay.Vec3";
        };

        return Vec3;
    })();

    overlay.Player = (function() {

        /**
         * Properties of a Player.
         * @typedef {Object} overlay.Player.$Properties
         * @property {string|null} [uId] Player uId
         * @property {string|null} [playerName] Player playerName
         * @property {string|null} [playerOpenId] Player playerOpenId
         * @property {string|null} [picUrl] Player picUrl
         * @property {string|null} [showPicUrl] Player showPicUrl
         * @property {string|null} [character] Player character
         * @property {number|null} [teamIdfromApi] Player teamIdfromApi
         * @property {number|null} [teamId] Player teamId
         * @property {string|null} [teamName] Player teamName
         * @property {overlay.Vec3.$Properties|null} [location] Player location
         * @property {number|null} [health] Player health
         * @property {number|null} [healthMax] Player healthMax
         * @property {number|null} [liveState] Player liveState
         * @property {boolean|null} [isFiring] Player isFiring
         * @property {boolean|null} [bHasDied] Player bHasDied
         * @property {boolean|null} [isOutsideBlueCircle] Player isOutsideBlueCircle
         * @property {number|null} [killNum] Player killNum
         * @property {number|null} [killNumBeforeDie] Player killNumBeforeDie
         * @property {number|null} [gotAirDropNum] Player gotAirDropNum
         * @property {number|null} [maxKillDistance] Player maxKillDistance
         * @property {number|null} [damage] Player damage
         * @property {number|null} [killNumInVehicle] Player killNumInVehicle
         * @property {number|null} [killNumByGrenade] Player killNumByGrenade
         * @property {number|null} [AIKillNum] Player AIKillNum
         * @property {number|null} [BossKillNum] Player BossKillNum
         * @property {number|null} [rank] Player rank
         * @property {number|null} [inDamage] Player inDamage
         * @property {number|null} [headShotNum] Player headShotNum
         * @property {number|null} [survivalTime] Player survivalTime
         * @property {number|null} [driveDistance] Player driveDistance
         * @property {number|null} [marchDistance] Player marchDistance
         * @property {number|null} [assists] Player assists
         * @property {number|null} [outsideBlueCircleTime] Player outsideBlueCircleTime
         * @property {number|null} [knockouts] Player knockouts
         * @property {number|null} [rescueTimes] Player rescueTimes
         * @property {number|null} [useSmokeGrenadeNum] Player useSmokeGrenadeNum
         * @property {number|null} [useFragGrenadeNum] Player useFragGrenadeNum
         * @property {number|null} [useBurnGrenadeNum] Player useBurnGrenadeNum
         * @property {number|null} [useFlashGrenadeNum] Player useFlashGrenadeNum
         * @property {number|null} [PoisonTotalDamage] Player PoisonTotalDamage
         * @property {number|null} [UseSelfRescueTime] Player UseSelfRescueTime
         * @property {number|null} [UseEmergencyCallTime] Player UseEmergencyCallTime
         * @property {number|null} [contribution] Player contribution
         * @property {number|null} [heal] Player heal
         * @property {string|null} [docId] Player docId
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Player.
         * @memberof overlay
         * @interface IPlayer
         * @augments overlay.Player.$Properties
         * @deprecated Use overlay.Player.$Properties instead.
         */

        /**
         * Shape of a Player.
         * @typedef {overlay.Player.$Properties} overlay.Player.$Shape
         */

        /**
         * Constructs a new Player.
         * @memberof overlay
         * @classdesc Represents a Player.
         * @constructor
         * @param {overlay.Player.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        var Player = function (properties) {
            if (properties)
                for (var keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Player uId.
         * @member {string} uId
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.uId = "";

        /**
         * Player playerName.
         * @member {string} playerName
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.playerName = "";

        /**
         * Player playerOpenId.
         * @member {string} playerOpenId
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.playerOpenId = "";

        /**
         * Player picUrl.
         * @member {string} picUrl
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.picUrl = "";

        /**
         * Player showPicUrl.
         * @member {string} showPicUrl
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.showPicUrl = "";

        /**
         * Player character.
         * @member {string} character
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.character = "";

        /**
         * Player teamIdfromApi.
         * @member {number} teamIdfromApi
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.teamIdfromApi = 0;

        /**
         * Player teamId.
         * @member {number} teamId
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.teamId = 0;

        /**
         * Player teamName.
         * @member {string} teamName
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.teamName = "";

        /**
         * Player location.
         * @member {overlay.Vec3.$Properties|null|undefined} location
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.location = null;

        /**
         * Player health.
         * @member {number|null|undefined} health
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.health = null;

        /**
         * Player healthMax.
         * @member {number|null|undefined} healthMax
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.healthMax = null;

        /**
         * Player liveState.
         * @member {number|null|undefined} liveState
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.liveState = null;

        /**
         * Player isFiring.
         * @member {boolean|null|undefined} isFiring
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.isFiring = null;

        /**
         * Player bHasDied.
         * @member {boolean|null|undefined} bHasDied
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.bHasDied = null;

        /**
         * Player isOutsideBlueCircle.
         * @member {boolean|null|undefined} isOutsideBlueCircle
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.isOutsideBlueCircle = null;

        /**
         * Player killNum.
         * @member {number|null|undefined} killNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.killNum = null;

        /**
         * Player killNumBeforeDie.
         * @member {number|null|undefined} killNumBeforeDie
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.killNumBeforeDie = null;

        /**
         * Player gotAirDropNum.
         * @member {number|null|undefined} gotAirDropNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.gotAirDropNum = null;

        /**
         * Player maxKillDistance.
         * @member {number|null|undefined} maxKillDistance
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.maxKillDistance = null;

        /**
         * Player damage.
         * @member {number|null|undefined} damage
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.damage = null;

        /**
         * Player killNumInVehicle.
         * @member {number|null|undefined} killNumInVehicle
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.killNumInVehicle = null;

        /**
         * Player killNumByGrenade.
         * @member {number|null|undefined} killNumByGrenade
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.killNumByGrenade = null;

        /**
         * Player AIKillNum.
         * @member {number} AIKillNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.AIKillNum = 0;

        /**
         * Player BossKillNum.
         * @member {number} BossKillNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.BossKillNum = 0;

        /**
         * Player rank.
         * @member {number|null|undefined} rank
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.rank = null;

        /**
         * Player inDamage.
         * @member {number} inDamage
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.inDamage = 0;

        /**
         * Player headShotNum.
         * @member {number|null|undefined} headShotNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.headShotNum = null;

        /**
         * Player survivalTime.
         * @member {number|null|undefined} survivalTime
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.survivalTime = null;

        /**
         * Player driveDistance.
         * @member {number|null|undefined} driveDistance
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.driveDistance = null;

        /**
         * Player marchDistance.
         * @member {number|null|undefined} marchDistance
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.marchDistance = null;

        /**
         * Player assists.
         * @member {number|null|undefined} assists
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.assists = null;

        /**
         * Player outsideBlueCircleTime.
         * @member {number} outsideBlueCircleTime
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.outsideBlueCircleTime = 0;

        /**
         * Player knockouts.
         * @member {number|null|undefined} knockouts
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.knockouts = null;

        /**
         * Player rescueTimes.
         * @member {number|null|undefined} rescueTimes
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.rescueTimes = null;

        /**
         * Player useSmokeGrenadeNum.
         * @member {number|null|undefined} useSmokeGrenadeNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.useSmokeGrenadeNum = null;

        /**
         * Player useFragGrenadeNum.
         * @member {number|null|undefined} useFragGrenadeNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.useFragGrenadeNum = null;

        /**
         * Player useBurnGrenadeNum.
         * @member {number|null|undefined} useBurnGrenadeNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.useBurnGrenadeNum = null;

        /**
         * Player useFlashGrenadeNum.
         * @member {number|null|undefined} useFlashGrenadeNum
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.useFlashGrenadeNum = null;

        /**
         * Player PoisonTotalDamage.
         * @member {number} PoisonTotalDamage
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.PoisonTotalDamage = 0;

        /**
         * Player UseSelfRescueTime.
         * @member {number} UseSelfRescueTime
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.UseSelfRescueTime = 0;

        /**
         * Player UseEmergencyCallTime.
         * @member {number} UseEmergencyCallTime
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.UseEmergencyCallTime = 0;

        /**
         * Player contribution.
         * @member {number|null|undefined} contribution
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.contribution = null;

        /**
         * Player heal.
         * @member {number|null|undefined} heal
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.heal = null;

        /**
         * Player docId.
         * @member {string} docId
         * @memberof overlay.Player
         * @instance
         */
        Player.prototype.docId = "";

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_location", {
            get: $util.oneOfGetter($oneOfFields = ["location"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_health", {
            get: $util.oneOfGetter($oneOfFields = ["health"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_healthMax", {
            get: $util.oneOfGetter($oneOfFields = ["healthMax"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_liveState", {
            get: $util.oneOfGetter($oneOfFields = ["liveState"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_isFiring", {
            get: $util.oneOfGetter($oneOfFields = ["isFiring"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_bHasDied", {
            get: $util.oneOfGetter($oneOfFields = ["bHasDied"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_isOutsideBlueCircle", {
            get: $util.oneOfGetter($oneOfFields = ["isOutsideBlueCircle"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_killNum", {
            get: $util.oneOfGetter($oneOfFields = ["killNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_killNumBeforeDie", {
            get: $util.oneOfGetter($oneOfFields = ["killNumBeforeDie"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_gotAirDropNum", {
            get: $util.oneOfGetter($oneOfFields = ["gotAirDropNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_maxKillDistance", {
            get: $util.oneOfGetter($oneOfFields = ["maxKillDistance"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_damage", {
            get: $util.oneOfGetter($oneOfFields = ["damage"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_killNumInVehicle", {
            get: $util.oneOfGetter($oneOfFields = ["killNumInVehicle"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_killNumByGrenade", {
            get: $util.oneOfGetter($oneOfFields = ["killNumByGrenade"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_rank", {
            get: $util.oneOfGetter($oneOfFields = ["rank"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_headShotNum", {
            get: $util.oneOfGetter($oneOfFields = ["headShotNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_survivalTime", {
            get: $util.oneOfGetter($oneOfFields = ["survivalTime"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_driveDistance", {
            get: $util.oneOfGetter($oneOfFields = ["driveDistance"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_marchDistance", {
            get: $util.oneOfGetter($oneOfFields = ["marchDistance"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_assists", {
            get: $util.oneOfGetter($oneOfFields = ["assists"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_knockouts", {
            get: $util.oneOfGetter($oneOfFields = ["knockouts"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_rescueTimes", {
            get: $util.oneOfGetter($oneOfFields = ["rescueTimes"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_useSmokeGrenadeNum", {
            get: $util.oneOfGetter($oneOfFields = ["useSmokeGrenadeNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_useFragGrenadeNum", {
            get: $util.oneOfGetter($oneOfFields = ["useFragGrenadeNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_useBurnGrenadeNum", {
            get: $util.oneOfGetter($oneOfFields = ["useBurnGrenadeNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_useFlashGrenadeNum", {
            get: $util.oneOfGetter($oneOfFields = ["useFlashGrenadeNum"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_contribution", {
            get: $util.oneOfGetter($oneOfFields = ["contribution"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        $Object.defineProperty(Player.prototype, "_heal", {
            get: $util.oneOfGetter($oneOfFields = ["heal"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new Player instance using the specified properties.
         * @function create
         * @memberof overlay.Player
         * @static
         * @param {overlay.Player.$Properties=} [properties] Properties to set
         * @returns {overlay.Player} Player instance
         * @type {{
         *   (properties: overlay.Player.$Shape): overlay.Player & overlay.Player.$Shape;
         *   (properties?: overlay.Player.$Properties): overlay.Player;
         * }}
         */
        Player.create = function(properties) {
            return new Player(properties);
        };

        /**
         * Encodes the specified Player message. Does not implicitly {@link overlay.Player.verify|verify} messages.
         * @function encode
         * @memberof overlay.Player
         * @static
         * @param {overlay.Player.$Properties} message Player message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Player.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.uId != null && $Object.hasOwnProperty.call(message, "uId") && message.uId !== "")
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.uId);
            if (message.playerName != null && $Object.hasOwnProperty.call(message, "playerName") && message.playerName !== "")
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.playerName);
            if (message.playerOpenId != null && $Object.hasOwnProperty.call(message, "playerOpenId") && message.playerOpenId !== "")
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.playerOpenId);
            if (message.picUrl != null && $Object.hasOwnProperty.call(message, "picUrl") && message.picUrl !== "")
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.picUrl);
            if (message.showPicUrl != null && $Object.hasOwnProperty.call(message, "showPicUrl") && message.showPicUrl !== "")
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.showPicUrl);
            if (message.character != null && $Object.hasOwnProperty.call(message, "character") && message.character !== "")
                writer.uint32(/* id 6, wireType 2 =*/50).string(message.character);
            if (message.teamIdfromApi != null && $Object.hasOwnProperty.call(message, "teamIdfromApi") && message.teamIdfromApi !== 0)
                writer.uint32(/* id 7, wireType 0 =*/56).int32(message.teamIdfromApi);
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId") && message.teamId !== 0)
                writer.uint32(/* id 8, wireType 0 =*/64).int32(message.teamId);
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName") && message.teamName !== "")
                writer.uint32(/* id 9, wireType 2 =*/74).string(message.teamName);
            if (message.location != null && $Object.hasOwnProperty.call(message, "location"))
                $root.overlay.Vec3.encode(message.location, writer.uint32(/* id 10, wireType 2 =*/82).fork(), _depth + 1).ldelim();
            if (message.health != null && $Object.hasOwnProperty.call(message, "health"))
                writer.uint32(/* id 11, wireType 0 =*/88).int32(message.health);
            if (message.healthMax != null && $Object.hasOwnProperty.call(message, "healthMax"))
                writer.uint32(/* id 12, wireType 0 =*/96).int32(message.healthMax);
            if (message.liveState != null && $Object.hasOwnProperty.call(message, "liveState"))
                writer.uint32(/* id 13, wireType 0 =*/104).int32(message.liveState);
            if (message.isFiring != null && $Object.hasOwnProperty.call(message, "isFiring"))
                writer.uint32(/* id 14, wireType 0 =*/112).bool(message.isFiring);
            if (message.bHasDied != null && $Object.hasOwnProperty.call(message, "bHasDied"))
                writer.uint32(/* id 15, wireType 0 =*/120).bool(message.bHasDied);
            if (message.isOutsideBlueCircle != null && $Object.hasOwnProperty.call(message, "isOutsideBlueCircle"))
                writer.uint32(/* id 16, wireType 0 =*/128).bool(message.isOutsideBlueCircle);
            if (message.killNum != null && $Object.hasOwnProperty.call(message, "killNum"))
                writer.uint32(/* id 20, wireType 0 =*/160).int32(message.killNum);
            if (message.killNumBeforeDie != null && $Object.hasOwnProperty.call(message, "killNumBeforeDie"))
                writer.uint32(/* id 21, wireType 0 =*/168).int32(message.killNumBeforeDie);
            if (message.gotAirDropNum != null && $Object.hasOwnProperty.call(message, "gotAirDropNum"))
                writer.uint32(/* id 22, wireType 0 =*/176).int32(message.gotAirDropNum);
            if (message.maxKillDistance != null && $Object.hasOwnProperty.call(message, "maxKillDistance"))
                writer.uint32(/* id 23, wireType 0 =*/184).int32(message.maxKillDistance);
            if (message.damage != null && $Object.hasOwnProperty.call(message, "damage"))
                writer.uint32(/* id 24, wireType 0 =*/192).int32(message.damage);
            if (message.killNumInVehicle != null && $Object.hasOwnProperty.call(message, "killNumInVehicle"))
                writer.uint32(/* id 25, wireType 0 =*/200).int32(message.killNumInVehicle);
            if (message.killNumByGrenade != null && $Object.hasOwnProperty.call(message, "killNumByGrenade"))
                writer.uint32(/* id 26, wireType 0 =*/208).int32(message.killNumByGrenade);
            if (message.AIKillNum != null && $Object.hasOwnProperty.call(message, "AIKillNum") && message.AIKillNum !== 0)
                writer.uint32(/* id 27, wireType 0 =*/216).int32(message.AIKillNum);
            if (message.BossKillNum != null && $Object.hasOwnProperty.call(message, "BossKillNum") && message.BossKillNum !== 0)
                writer.uint32(/* id 28, wireType 0 =*/224).int32(message.BossKillNum);
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank"))
                writer.uint32(/* id 29, wireType 0 =*/232).int32(message.rank);
            if (message.inDamage != null && $Object.hasOwnProperty.call(message, "inDamage") && message.inDamage !== 0)
                writer.uint32(/* id 30, wireType 0 =*/240).int32(message.inDamage);
            if (message.headShotNum != null && $Object.hasOwnProperty.call(message, "headShotNum"))
                writer.uint32(/* id 31, wireType 0 =*/248).int32(message.headShotNum);
            if (message.survivalTime != null && $Object.hasOwnProperty.call(message, "survivalTime"))
                writer.uint32(/* id 32, wireType 0 =*/256).int32(message.survivalTime);
            if (message.driveDistance != null && $Object.hasOwnProperty.call(message, "driveDistance"))
                writer.uint32(/* id 33, wireType 0 =*/264).int32(message.driveDistance);
            if (message.marchDistance != null && $Object.hasOwnProperty.call(message, "marchDistance"))
                writer.uint32(/* id 34, wireType 0 =*/272).int32(message.marchDistance);
            if (message.assists != null && $Object.hasOwnProperty.call(message, "assists"))
                writer.uint32(/* id 35, wireType 0 =*/280).int32(message.assists);
            if (message.outsideBlueCircleTime != null && $Object.hasOwnProperty.call(message, "outsideBlueCircleTime") && message.outsideBlueCircleTime !== 0)
                writer.uint32(/* id 36, wireType 0 =*/288).int32(message.outsideBlueCircleTime);
            if (message.knockouts != null && $Object.hasOwnProperty.call(message, "knockouts"))
                writer.uint32(/* id 37, wireType 0 =*/296).int32(message.knockouts);
            if (message.rescueTimes != null && $Object.hasOwnProperty.call(message, "rescueTimes"))
                writer.uint32(/* id 38, wireType 0 =*/304).int32(message.rescueTimes);
            if (message.useSmokeGrenadeNum != null && $Object.hasOwnProperty.call(message, "useSmokeGrenadeNum"))
                writer.uint32(/* id 39, wireType 0 =*/312).int32(message.useSmokeGrenadeNum);
            if (message.useFragGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFragGrenadeNum"))
                writer.uint32(/* id 40, wireType 0 =*/320).int32(message.useFragGrenadeNum);
            if (message.useBurnGrenadeNum != null && $Object.hasOwnProperty.call(message, "useBurnGrenadeNum"))
                writer.uint32(/* id 41, wireType 0 =*/328).int32(message.useBurnGrenadeNum);
            if (message.useFlashGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFlashGrenadeNum"))
                writer.uint32(/* id 42, wireType 0 =*/336).int32(message.useFlashGrenadeNum);
            if (message.PoisonTotalDamage != null && $Object.hasOwnProperty.call(message, "PoisonTotalDamage") && message.PoisonTotalDamage !== 0)
                writer.uint32(/* id 43, wireType 0 =*/344).int32(message.PoisonTotalDamage);
            if (message.UseSelfRescueTime != null && $Object.hasOwnProperty.call(message, "UseSelfRescueTime") && message.UseSelfRescueTime !== 0)
                writer.uint32(/* id 44, wireType 0 =*/352).int32(message.UseSelfRescueTime);
            if (message.UseEmergencyCallTime != null && $Object.hasOwnProperty.call(message, "UseEmergencyCallTime") && message.UseEmergencyCallTime !== 0)
                writer.uint32(/* id 45, wireType 0 =*/360).int32(message.UseEmergencyCallTime);
            if (message.contribution != null && $Object.hasOwnProperty.call(message, "contribution"))
                writer.uint32(/* id 46, wireType 0 =*/368).int32(message.contribution);
            if (message.heal != null && $Object.hasOwnProperty.call(message, "heal"))
                writer.uint32(/* id 47, wireType 0 =*/376).int32(message.heal);
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId") && message.docId !== "")
                writer.uint32(/* id 48, wireType 2 =*/386).string(message.docId);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Player message, length delimited. Does not implicitly {@link overlay.Player.verify|verify} messages.
         * @function encodeDelimited
         * @memberof overlay.Player
         * @static
         * @param {overlay.Player.$Properties} message Player message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Player.encodeDelimited = function(message, writer) {
            return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
        };

        /**
         * Decodes a Player message from the specified reader or buffer.
         * @function decode
         * @memberof overlay.Player
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {overlay.Player & overlay.Player.$Shape} Player
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Player.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            var end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.overlay.Player(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.uId = value;
                        else
                            delete message.uId;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.playerName = value;
                        else
                            delete message.playerName;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.playerOpenId = value;
                        else
                            delete message.playerOpenId;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.picUrl = value;
                        else
                            delete message.picUrl;
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.showPicUrl = value;
                        else
                            delete message.showPicUrl;
                        continue;
                    }
                case 6: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.character = value;
                        else
                            delete message.character;
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.teamIdfromApi = value;
                        else
                            delete message.teamIdfromApi;
                        continue;
                    }
                case 8: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.teamId = value;
                        else
                            delete message.teamId;
                        continue;
                    }
                case 9: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.teamName = value;
                        else
                            delete message.teamName;
                        continue;
                    }
                case 10: {
                        if (wireType !== 2)
                            break;
                        message.location = $root.overlay.Vec3.decode(reader, reader.uint32(), $undefined, _depth + 1, message.location);
                        message._location = "location";
                        continue;
                    }
                case 11: {
                        if (wireType !== 0)
                            break;
                        message.health = reader.int32();
                        message._health = "health";
                        continue;
                    }
                case 12: {
                        if (wireType !== 0)
                            break;
                        message.healthMax = reader.int32();
                        message._healthMax = "healthMax";
                        continue;
                    }
                case 13: {
                        if (wireType !== 0)
                            break;
                        message.liveState = reader.int32();
                        message._liveState = "liveState";
                        continue;
                    }
                case 14: {
                        if (wireType !== 0)
                            break;
                        message.isFiring = reader.bool();
                        message._isFiring = "isFiring";
                        continue;
                    }
                case 15: {
                        if (wireType !== 0)
                            break;
                        message.bHasDied = reader.bool();
                        message._bHasDied = "bHasDied";
                        continue;
                    }
                case 16: {
                        if (wireType !== 0)
                            break;
                        message.isOutsideBlueCircle = reader.bool();
                        message._isOutsideBlueCircle = "isOutsideBlueCircle";
                        continue;
                    }
                case 20: {
                        if (wireType !== 0)
                            break;
                        message.killNum = reader.int32();
                        message._killNum = "killNum";
                        continue;
                    }
                case 21: {
                        if (wireType !== 0)
                            break;
                        message.killNumBeforeDie = reader.int32();
                        message._killNumBeforeDie = "killNumBeforeDie";
                        continue;
                    }
                case 22: {
                        if (wireType !== 0)
                            break;
                        message.gotAirDropNum = reader.int32();
                        message._gotAirDropNum = "gotAirDropNum";
                        continue;
                    }
                case 23: {
                        if (wireType !== 0)
                            break;
                        message.maxKillDistance = reader.int32();
                        message._maxKillDistance = "maxKillDistance";
                        continue;
                    }
                case 24: {
                        if (wireType !== 0)
                            break;
                        message.damage = reader.int32();
                        message._damage = "damage";
                        continue;
                    }
                case 25: {
                        if (wireType !== 0)
                            break;
                        message.killNumInVehicle = reader.int32();
                        message._killNumInVehicle = "killNumInVehicle";
                        continue;
                    }
                case 26: {
                        if (wireType !== 0)
                            break;
                        message.killNumByGrenade = reader.int32();
                        message._killNumByGrenade = "killNumByGrenade";
                        continue;
                    }
                case 27: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.AIKillNum = value;
                        else
                            delete message.AIKillNum;
                        continue;
                    }
                case 28: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.BossKillNum = value;
                        else
                            delete message.BossKillNum;
                        continue;
                    }
                case 29: {
                        if (wireType !== 0)
                            break;
                        message.rank = reader.int32();
                        message._rank = "rank";
                        continue;
                    }
                case 30: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.inDamage = value;
                        else
                            delete message.inDamage;
                        continue;
                    }
                case 31: {
                        if (wireType !== 0)
                            break;
                        message.headShotNum = reader.int32();
                        message._headShotNum = "headShotNum";
                        continue;
                    }
                case 32: {
                        if (wireType !== 0)
                            break;
                        message.survivalTime = reader.int32();
                        message._survivalTime = "survivalTime";
                        continue;
                    }
                case 33: {
                        if (wireType !== 0)
                            break;
                        message.driveDistance = reader.int32();
                        message._driveDistance = "driveDistance";
                        continue;
                    }
                case 34: {
                        if (wireType !== 0)
                            break;
                        message.marchDistance = reader.int32();
                        message._marchDistance = "marchDistance";
                        continue;
                    }
                case 35: {
                        if (wireType !== 0)
                            break;
                        message.assists = reader.int32();
                        message._assists = "assists";
                        continue;
                    }
                case 36: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.outsideBlueCircleTime = value;
                        else
                            delete message.outsideBlueCircleTime;
                        continue;
                    }
                case 37: {
                        if (wireType !== 0)
                            break;
                        message.knockouts = reader.int32();
                        message._knockouts = "knockouts";
                        continue;
                    }
                case 38: {
                        if (wireType !== 0)
                            break;
                        message.rescueTimes = reader.int32();
                        message._rescueTimes = "rescueTimes";
                        continue;
                    }
                case 39: {
                        if (wireType !== 0)
                            break;
                        message.useSmokeGrenadeNum = reader.int32();
                        message._useSmokeGrenadeNum = "useSmokeGrenadeNum";
                        continue;
                    }
                case 40: {
                        if (wireType !== 0)
                            break;
                        message.useFragGrenadeNum = reader.int32();
                        message._useFragGrenadeNum = "useFragGrenadeNum";
                        continue;
                    }
                case 41: {
                        if (wireType !== 0)
                            break;
                        message.useBurnGrenadeNum = reader.int32();
                        message._useBurnGrenadeNum = "useBurnGrenadeNum";
                        continue;
                    }
                case 42: {
                        if (wireType !== 0)
                            break;
                        message.useFlashGrenadeNum = reader.int32();
                        message._useFlashGrenadeNum = "useFlashGrenadeNum";
                        continue;
                    }
                case 43: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.PoisonTotalDamage = value;
                        else
                            delete message.PoisonTotalDamage;
                        continue;
                    }
                case 44: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.UseSelfRescueTime = value;
                        else
                            delete message.UseSelfRescueTime;
                        continue;
                    }
                case 45: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.UseEmergencyCallTime = value;
                        else
                            delete message.UseEmergencyCallTime;
                        continue;
                    }
                case 46: {
                        if (wireType !== 0)
                            break;
                        message.contribution = reader.int32();
                        message._contribution = "contribution";
                        continue;
                    }
                case 47: {
                        if (wireType !== 0)
                            break;
                        message.heal = reader.int32();
                        message._heal = "heal";
                        continue;
                    }
                case 48: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.docId = value;
                        else
                            delete message.docId;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Decodes a Player message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof overlay.Player
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {overlay.Player & overlay.Player.$Shape} Player
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Player.decodeDelimited = function(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Player message.
         * @function verify
         * @memberof overlay.Player
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Player.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            var properties = {};
            if (message.uId != null && $Object.hasOwnProperty.call(message, "uId"))
                if (!$util.isString(message.uId))
                    return "uId: string expected";
            if (message.playerName != null && $Object.hasOwnProperty.call(message, "playerName"))
                if (!$util.isString(message.playerName))
                    return "playerName: string expected";
            if (message.playerOpenId != null && $Object.hasOwnProperty.call(message, "playerOpenId"))
                if (!$util.isString(message.playerOpenId))
                    return "playerOpenId: string expected";
            if (message.picUrl != null && $Object.hasOwnProperty.call(message, "picUrl"))
                if (!$util.isString(message.picUrl))
                    return "picUrl: string expected";
            if (message.showPicUrl != null && $Object.hasOwnProperty.call(message, "showPicUrl"))
                if (!$util.isString(message.showPicUrl))
                    return "showPicUrl: string expected";
            if (message.character != null && $Object.hasOwnProperty.call(message, "character"))
                if (!$util.isString(message.character))
                    return "character: string expected";
            if (message.teamIdfromApi != null && $Object.hasOwnProperty.call(message, "teamIdfromApi"))
                if (!$util.isInteger(message.teamIdfromApi))
                    return "teamIdfromApi: integer expected";
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId"))
                if (!$util.isInteger(message.teamId))
                    return "teamId: integer expected";
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName"))
                if (!$util.isString(message.teamName))
                    return "teamName: string expected";
            if (message.location != null && $Object.hasOwnProperty.call(message, "location")) {
                properties._location = 1;
                {
                    var error = $root.overlay.Vec3.verify(message.location, _depth + 1);
                    if (error)
                        return "location." + error;
                }
            }
            if (message.health != null && $Object.hasOwnProperty.call(message, "health")) {
                properties._health = 1;
                if (!$util.isInteger(message.health))
                    return "health: integer expected";
            }
            if (message.healthMax != null && $Object.hasOwnProperty.call(message, "healthMax")) {
                properties._healthMax = 1;
                if (!$util.isInteger(message.healthMax))
                    return "healthMax: integer expected";
            }
            if (message.liveState != null && $Object.hasOwnProperty.call(message, "liveState")) {
                properties._liveState = 1;
                if (!$util.isInteger(message.liveState))
                    return "liveState: integer expected";
            }
            if (message.isFiring != null && $Object.hasOwnProperty.call(message, "isFiring")) {
                properties._isFiring = 1;
                if (typeof message.isFiring !== "boolean")
                    return "isFiring: boolean expected";
            }
            if (message.bHasDied != null && $Object.hasOwnProperty.call(message, "bHasDied")) {
                properties._bHasDied = 1;
                if (typeof message.bHasDied !== "boolean")
                    return "bHasDied: boolean expected";
            }
            if (message.isOutsideBlueCircle != null && $Object.hasOwnProperty.call(message, "isOutsideBlueCircle")) {
                properties._isOutsideBlueCircle = 1;
                if (typeof message.isOutsideBlueCircle !== "boolean")
                    return "isOutsideBlueCircle: boolean expected";
            }
            if (message.killNum != null && $Object.hasOwnProperty.call(message, "killNum")) {
                properties._killNum = 1;
                if (!$util.isInteger(message.killNum))
                    return "killNum: integer expected";
            }
            if (message.killNumBeforeDie != null && $Object.hasOwnProperty.call(message, "killNumBeforeDie")) {
                properties._killNumBeforeDie = 1;
                if (!$util.isInteger(message.killNumBeforeDie))
                    return "killNumBeforeDie: integer expected";
            }
            if (message.gotAirDropNum != null && $Object.hasOwnProperty.call(message, "gotAirDropNum")) {
                properties._gotAirDropNum = 1;
                if (!$util.isInteger(message.gotAirDropNum))
                    return "gotAirDropNum: integer expected";
            }
            if (message.maxKillDistance != null && $Object.hasOwnProperty.call(message, "maxKillDistance")) {
                properties._maxKillDistance = 1;
                if (!$util.isInteger(message.maxKillDistance))
                    return "maxKillDistance: integer expected";
            }
            if (message.damage != null && $Object.hasOwnProperty.call(message, "damage")) {
                properties._damage = 1;
                if (!$util.isInteger(message.damage))
                    return "damage: integer expected";
            }
            if (message.killNumInVehicle != null && $Object.hasOwnProperty.call(message, "killNumInVehicle")) {
                properties._killNumInVehicle = 1;
                if (!$util.isInteger(message.killNumInVehicle))
                    return "killNumInVehicle: integer expected";
            }
            if (message.killNumByGrenade != null && $Object.hasOwnProperty.call(message, "killNumByGrenade")) {
                properties._killNumByGrenade = 1;
                if (!$util.isInteger(message.killNumByGrenade))
                    return "killNumByGrenade: integer expected";
            }
            if (message.AIKillNum != null && $Object.hasOwnProperty.call(message, "AIKillNum"))
                if (!$util.isInteger(message.AIKillNum))
                    return "AIKillNum: integer expected";
            if (message.BossKillNum != null && $Object.hasOwnProperty.call(message, "BossKillNum"))
                if (!$util.isInteger(message.BossKillNum))
                    return "BossKillNum: integer expected";
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank")) {
                properties._rank = 1;
                if (!$util.isInteger(message.rank))
                    return "rank: integer expected";
            }
            if (message.inDamage != null && $Object.hasOwnProperty.call(message, "inDamage"))
                if (!$util.isInteger(message.inDamage))
                    return "inDamage: integer expected";
            if (message.headShotNum != null && $Object.hasOwnProperty.call(message, "headShotNum")) {
                properties._headShotNum = 1;
                if (!$util.isInteger(message.headShotNum))
                    return "headShotNum: integer expected";
            }
            if (message.survivalTime != null && $Object.hasOwnProperty.call(message, "survivalTime")) {
                properties._survivalTime = 1;
                if (!$util.isInteger(message.survivalTime))
                    return "survivalTime: integer expected";
            }
            if (message.driveDistance != null && $Object.hasOwnProperty.call(message, "driveDistance")) {
                properties._driveDistance = 1;
                if (!$util.isInteger(message.driveDistance))
                    return "driveDistance: integer expected";
            }
            if (message.marchDistance != null && $Object.hasOwnProperty.call(message, "marchDistance")) {
                properties._marchDistance = 1;
                if (!$util.isInteger(message.marchDistance))
                    return "marchDistance: integer expected";
            }
            if (message.assists != null && $Object.hasOwnProperty.call(message, "assists")) {
                properties._assists = 1;
                if (!$util.isInteger(message.assists))
                    return "assists: integer expected";
            }
            if (message.outsideBlueCircleTime != null && $Object.hasOwnProperty.call(message, "outsideBlueCircleTime"))
                if (!$util.isInteger(message.outsideBlueCircleTime))
                    return "outsideBlueCircleTime: integer expected";
            if (message.knockouts != null && $Object.hasOwnProperty.call(message, "knockouts")) {
                properties._knockouts = 1;
                if (!$util.isInteger(message.knockouts))
                    return "knockouts: integer expected";
            }
            if (message.rescueTimes != null && $Object.hasOwnProperty.call(message, "rescueTimes")) {
                properties._rescueTimes = 1;
                if (!$util.isInteger(message.rescueTimes))
                    return "rescueTimes: integer expected";
            }
            if (message.useSmokeGrenadeNum != null && $Object.hasOwnProperty.call(message, "useSmokeGrenadeNum")) {
                properties._useSmokeGrenadeNum = 1;
                if (!$util.isInteger(message.useSmokeGrenadeNum))
                    return "useSmokeGrenadeNum: integer expected";
            }
            if (message.useFragGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFragGrenadeNum")) {
                properties._useFragGrenadeNum = 1;
                if (!$util.isInteger(message.useFragGrenadeNum))
                    return "useFragGrenadeNum: integer expected";
            }
            if (message.useBurnGrenadeNum != null && $Object.hasOwnProperty.call(message, "useBurnGrenadeNum")) {
                properties._useBurnGrenadeNum = 1;
                if (!$util.isInteger(message.useBurnGrenadeNum))
                    return "useBurnGrenadeNum: integer expected";
            }
            if (message.useFlashGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFlashGrenadeNum")) {
                properties._useFlashGrenadeNum = 1;
                if (!$util.isInteger(message.useFlashGrenadeNum))
                    return "useFlashGrenadeNum: integer expected";
            }
            if (message.PoisonTotalDamage != null && $Object.hasOwnProperty.call(message, "PoisonTotalDamage"))
                if (!$util.isInteger(message.PoisonTotalDamage))
                    return "PoisonTotalDamage: integer expected";
            if (message.UseSelfRescueTime != null && $Object.hasOwnProperty.call(message, "UseSelfRescueTime"))
                if (!$util.isInteger(message.UseSelfRescueTime))
                    return "UseSelfRescueTime: integer expected";
            if (message.UseEmergencyCallTime != null && $Object.hasOwnProperty.call(message, "UseEmergencyCallTime"))
                if (!$util.isInteger(message.UseEmergencyCallTime))
                    return "UseEmergencyCallTime: integer expected";
            if (message.contribution != null && $Object.hasOwnProperty.call(message, "contribution")) {
                properties._contribution = 1;
                if (!$util.isInteger(message.contribution))
                    return "contribution: integer expected";
            }
            if (message.heal != null && $Object.hasOwnProperty.call(message, "heal")) {
                properties._heal = 1;
                if (!$util.isInteger(message.heal))
                    return "heal: integer expected";
            }
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId"))
                if (!$util.isString(message.docId))
                    return "docId: string expected";
            return null;
        };

        /**
         * Creates a Player message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof overlay.Player
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {overlay.Player} Player
         */
        Player.fromObject = function (object, _depth) {
            if (object instanceof $root.overlay.Player)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".overlay.Player: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var message = new $root.overlay.Player();
            if (object.uId != null)
                if (typeof object.uId !== "string" || object.uId.length)
                    message.uId = $String(object.uId);
            if (object.playerName != null)
                if (typeof object.playerName !== "string" || object.playerName.length)
                    message.playerName = $String(object.playerName);
            if (object.playerOpenId != null)
                if (typeof object.playerOpenId !== "string" || object.playerOpenId.length)
                    message.playerOpenId = $String(object.playerOpenId);
            if (object.picUrl != null)
                if (typeof object.picUrl !== "string" || object.picUrl.length)
                    message.picUrl = $String(object.picUrl);
            if (object.showPicUrl != null)
                if (typeof object.showPicUrl !== "string" || object.showPicUrl.length)
                    message.showPicUrl = $String(object.showPicUrl);
            if (object.character != null)
                if (typeof object.character !== "string" || object.character.length)
                    message.character = $String(object.character);
            if (object.teamIdfromApi != null)
                if ($Number(object.teamIdfromApi) !== 0)
                    message.teamIdfromApi = object.teamIdfromApi | 0;
            if (object.teamId != null)
                if ($Number(object.teamId) !== 0)
                    message.teamId = object.teamId | 0;
            if (object.teamName != null)
                if (typeof object.teamName !== "string" || object.teamName.length)
                    message.teamName = $String(object.teamName);
            if (object.location != null) {
                if (!$util.isObject(object.location))
                    throw $TypeError(".overlay.Player.location: object expected");
                message.location = $root.overlay.Vec3.fromObject(object.location, _depth + 1);
            }
            if (object.health != null)
                message.health = object.health | 0;
            if (object.healthMax != null)
                message.healthMax = object.healthMax | 0;
            if (object.liveState != null)
                message.liveState = object.liveState | 0;
            if (object.isFiring != null)
                message.isFiring = $Boolean(object.isFiring);
            if (object.bHasDied != null)
                message.bHasDied = $Boolean(object.bHasDied);
            if (object.isOutsideBlueCircle != null)
                message.isOutsideBlueCircle = $Boolean(object.isOutsideBlueCircle);
            if (object.killNum != null)
                message.killNum = object.killNum | 0;
            if (object.killNumBeforeDie != null)
                message.killNumBeforeDie = object.killNumBeforeDie | 0;
            if (object.gotAirDropNum != null)
                message.gotAirDropNum = object.gotAirDropNum | 0;
            if (object.maxKillDistance != null)
                message.maxKillDistance = object.maxKillDistance | 0;
            if (object.damage != null)
                message.damage = object.damage | 0;
            if (object.killNumInVehicle != null)
                message.killNumInVehicle = object.killNumInVehicle | 0;
            if (object.killNumByGrenade != null)
                message.killNumByGrenade = object.killNumByGrenade | 0;
            if (object.AIKillNum != null)
                if ($Number(object.AIKillNum) !== 0)
                    message.AIKillNum = object.AIKillNum | 0;
            if (object.BossKillNum != null)
                if ($Number(object.BossKillNum) !== 0)
                    message.BossKillNum = object.BossKillNum | 0;
            if (object.rank != null)
                message.rank = object.rank | 0;
            if (object.inDamage != null)
                if ($Number(object.inDamage) !== 0)
                    message.inDamage = object.inDamage | 0;
            if (object.headShotNum != null)
                message.headShotNum = object.headShotNum | 0;
            if (object.survivalTime != null)
                message.survivalTime = object.survivalTime | 0;
            if (object.driveDistance != null)
                message.driveDistance = object.driveDistance | 0;
            if (object.marchDistance != null)
                message.marchDistance = object.marchDistance | 0;
            if (object.assists != null)
                message.assists = object.assists | 0;
            if (object.outsideBlueCircleTime != null)
                if ($Number(object.outsideBlueCircleTime) !== 0)
                    message.outsideBlueCircleTime = object.outsideBlueCircleTime | 0;
            if (object.knockouts != null)
                message.knockouts = object.knockouts | 0;
            if (object.rescueTimes != null)
                message.rescueTimes = object.rescueTimes | 0;
            if (object.useSmokeGrenadeNum != null)
                message.useSmokeGrenadeNum = object.useSmokeGrenadeNum | 0;
            if (object.useFragGrenadeNum != null)
                message.useFragGrenadeNum = object.useFragGrenadeNum | 0;
            if (object.useBurnGrenadeNum != null)
                message.useBurnGrenadeNum = object.useBurnGrenadeNum | 0;
            if (object.useFlashGrenadeNum != null)
                message.useFlashGrenadeNum = object.useFlashGrenadeNum | 0;
            if (object.PoisonTotalDamage != null)
                if ($Number(object.PoisonTotalDamage) !== 0)
                    message.PoisonTotalDamage = object.PoisonTotalDamage | 0;
            if (object.UseSelfRescueTime != null)
                if ($Number(object.UseSelfRescueTime) !== 0)
                    message.UseSelfRescueTime = object.UseSelfRescueTime | 0;
            if (object.UseEmergencyCallTime != null)
                if ($Number(object.UseEmergencyCallTime) !== 0)
                    message.UseEmergencyCallTime = object.UseEmergencyCallTime | 0;
            if (object.contribution != null)
                message.contribution = object.contribution | 0;
            if (object.heal != null)
                message.heal = object.heal | 0;
            if (object.docId != null)
                if (typeof object.docId !== "string" || object.docId.length)
                    message.docId = $String(object.docId);
            return message;
        };

        /**
         * Creates a plain object from a Player message. Also converts values to other types if specified.
         * @function toObject
         * @memberof overlay.Player
         * @static
         * @param {overlay.Player} message Player
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Player.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var object = {};
            if (options.defaults) {
                object.uId = "";
                object.playerName = "";
                object.playerOpenId = "";
                object.picUrl = "";
                object.showPicUrl = "";
                object.character = "";
                object.teamIdfromApi = 0;
                object.teamId = 0;
                object.teamName = "";
                object.AIKillNum = 0;
                object.BossKillNum = 0;
                object.inDamage = 0;
                object.outsideBlueCircleTime = 0;
                object.PoisonTotalDamage = 0;
                object.UseSelfRescueTime = 0;
                object.UseEmergencyCallTime = 0;
                object.docId = "";
            }
            if (message.uId != null && $Object.hasOwnProperty.call(message, "uId"))
                object.uId = message.uId;
            if (message.playerName != null && $Object.hasOwnProperty.call(message, "playerName"))
                object.playerName = message.playerName;
            if (message.playerOpenId != null && $Object.hasOwnProperty.call(message, "playerOpenId"))
                object.playerOpenId = message.playerOpenId;
            if (message.picUrl != null && $Object.hasOwnProperty.call(message, "picUrl"))
                object.picUrl = message.picUrl;
            if (message.showPicUrl != null && $Object.hasOwnProperty.call(message, "showPicUrl"))
                object.showPicUrl = message.showPicUrl;
            if (message.character != null && $Object.hasOwnProperty.call(message, "character"))
                object.character = message.character;
            if (message.teamIdfromApi != null && $Object.hasOwnProperty.call(message, "teamIdfromApi"))
                object.teamIdfromApi = message.teamIdfromApi;
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId"))
                object.teamId = message.teamId;
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName"))
                object.teamName = message.teamName;
            if (message.location != null && $Object.hasOwnProperty.call(message, "location"))
                object.location = $root.overlay.Vec3.toObject(message.location, options, _depth + 1);
            if (message.health != null && $Object.hasOwnProperty.call(message, "health"))
                object.health = message.health;
            if (message.healthMax != null && $Object.hasOwnProperty.call(message, "healthMax"))
                object.healthMax = message.healthMax;
            if (message.liveState != null && $Object.hasOwnProperty.call(message, "liveState"))
                object.liveState = message.liveState;
            if (message.isFiring != null && $Object.hasOwnProperty.call(message, "isFiring"))
                object.isFiring = message.isFiring;
            if (message.bHasDied != null && $Object.hasOwnProperty.call(message, "bHasDied"))
                object.bHasDied = message.bHasDied;
            if (message.isOutsideBlueCircle != null && $Object.hasOwnProperty.call(message, "isOutsideBlueCircle"))
                object.isOutsideBlueCircle = message.isOutsideBlueCircle;
            if (message.killNum != null && $Object.hasOwnProperty.call(message, "killNum"))
                object.killNum = message.killNum;
            if (message.killNumBeforeDie != null && $Object.hasOwnProperty.call(message, "killNumBeforeDie"))
                object.killNumBeforeDie = message.killNumBeforeDie;
            if (message.gotAirDropNum != null && $Object.hasOwnProperty.call(message, "gotAirDropNum"))
                object.gotAirDropNum = message.gotAirDropNum;
            if (message.maxKillDistance != null && $Object.hasOwnProperty.call(message, "maxKillDistance"))
                object.maxKillDistance = message.maxKillDistance;
            if (message.damage != null && $Object.hasOwnProperty.call(message, "damage"))
                object.damage = message.damage;
            if (message.killNumInVehicle != null && $Object.hasOwnProperty.call(message, "killNumInVehicle"))
                object.killNumInVehicle = message.killNumInVehicle;
            if (message.killNumByGrenade != null && $Object.hasOwnProperty.call(message, "killNumByGrenade"))
                object.killNumByGrenade = message.killNumByGrenade;
            if (message.AIKillNum != null && $Object.hasOwnProperty.call(message, "AIKillNum"))
                object.AIKillNum = message.AIKillNum;
            if (message.BossKillNum != null && $Object.hasOwnProperty.call(message, "BossKillNum"))
                object.BossKillNum = message.BossKillNum;
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank"))
                object.rank = message.rank;
            if (message.inDamage != null && $Object.hasOwnProperty.call(message, "inDamage"))
                object.inDamage = message.inDamage;
            if (message.headShotNum != null && $Object.hasOwnProperty.call(message, "headShotNum"))
                object.headShotNum = message.headShotNum;
            if (message.survivalTime != null && $Object.hasOwnProperty.call(message, "survivalTime"))
                object.survivalTime = message.survivalTime;
            if (message.driveDistance != null && $Object.hasOwnProperty.call(message, "driveDistance"))
                object.driveDistance = message.driveDistance;
            if (message.marchDistance != null && $Object.hasOwnProperty.call(message, "marchDistance"))
                object.marchDistance = message.marchDistance;
            if (message.assists != null && $Object.hasOwnProperty.call(message, "assists"))
                object.assists = message.assists;
            if (message.outsideBlueCircleTime != null && $Object.hasOwnProperty.call(message, "outsideBlueCircleTime"))
                object.outsideBlueCircleTime = message.outsideBlueCircleTime;
            if (message.knockouts != null && $Object.hasOwnProperty.call(message, "knockouts"))
                object.knockouts = message.knockouts;
            if (message.rescueTimes != null && $Object.hasOwnProperty.call(message, "rescueTimes"))
                object.rescueTimes = message.rescueTimes;
            if (message.useSmokeGrenadeNum != null && $Object.hasOwnProperty.call(message, "useSmokeGrenadeNum"))
                object.useSmokeGrenadeNum = message.useSmokeGrenadeNum;
            if (message.useFragGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFragGrenadeNum"))
                object.useFragGrenadeNum = message.useFragGrenadeNum;
            if (message.useBurnGrenadeNum != null && $Object.hasOwnProperty.call(message, "useBurnGrenadeNum"))
                object.useBurnGrenadeNum = message.useBurnGrenadeNum;
            if (message.useFlashGrenadeNum != null && $Object.hasOwnProperty.call(message, "useFlashGrenadeNum"))
                object.useFlashGrenadeNum = message.useFlashGrenadeNum;
            if (message.PoisonTotalDamage != null && $Object.hasOwnProperty.call(message, "PoisonTotalDamage"))
                object.PoisonTotalDamage = message.PoisonTotalDamage;
            if (message.UseSelfRescueTime != null && $Object.hasOwnProperty.call(message, "UseSelfRescueTime"))
                object.UseSelfRescueTime = message.UseSelfRescueTime;
            if (message.UseEmergencyCallTime != null && $Object.hasOwnProperty.call(message, "UseEmergencyCallTime"))
                object.UseEmergencyCallTime = message.UseEmergencyCallTime;
            if (message.contribution != null && $Object.hasOwnProperty.call(message, "contribution"))
                object.contribution = message.contribution;
            if (message.heal != null && $Object.hasOwnProperty.call(message, "heal"))
                object.heal = message.heal;
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId"))
                object.docId = message.docId;
            return object;
        };

        /**
         * Converts this Player to JSON.
         * @function toJSON
         * @memberof overlay.Player
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Player.prototype.toJSON = function() {
            return Player.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Player
         * @function getTypeUrl
         * @memberof overlay.Player
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Player.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/overlay.Player";
        };

        return Player;
    })();

    overlay.Team = (function() {

        /**
         * Properties of a Team.
         * @typedef {Object} overlay.Team.$Properties
         * @property {string|null} [teamId] Team teamId
         * @property {string|null} [docId] Team docId
         * @property {string|null} [teamName] Team teamName
         * @property {string|null} [teamTag] Team teamTag
         * @property {string|null} [teamLogo] Team teamLogo
         * @property {number|null} [slot] Team slot
         * @property {number|null} [placePoints] Team placePoints
         * @property {number|null} [rank] Team rank
         * @property {number|null} [wwcd] Team wwcd
         * @property {number|null} [matchesPlayed] Team matchesPlayed
         * @property {Array.<overlay.Player.$Properties>|null} [players] Team players
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Team.
         * @memberof overlay
         * @interface ITeam
         * @augments overlay.Team.$Properties
         * @deprecated Use overlay.Team.$Properties instead.
         */

        /**
         * Shape of a Team.
         * @typedef {overlay.Team.$Properties} overlay.Team.$Shape
         */

        /**
         * Constructs a new Team.
         * @memberof overlay
         * @classdesc Represents a Team.
         * @constructor
         * @param {overlay.Team.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        var Team = function (properties) {
            this.players = [];
            if (properties)
                for (var keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Team teamId.
         * @member {string} teamId
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.teamId = "";

        /**
         * Team docId.
         * @member {string} docId
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.docId = "";

        /**
         * Team teamName.
         * @member {string} teamName
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.teamName = "";

        /**
         * Team teamTag.
         * @member {string} teamTag
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.teamTag = "";

        /**
         * Team teamLogo.
         * @member {string} teamLogo
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.teamLogo = "";

        /**
         * Team slot.
         * @member {number} slot
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.slot = 0;

        /**
         * Team placePoints.
         * @member {number} placePoints
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.placePoints = 0;

        /**
         * Team rank.
         * @member {number} rank
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.rank = 0;

        /**
         * Team wwcd.
         * @member {number} wwcd
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.wwcd = 0;

        /**
         * Team matchesPlayed.
         * @member {number} matchesPlayed
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.matchesPlayed = 0;

        /**
         * Team players.
         * @member {Array.<overlay.Player.$Properties>} players
         * @memberof overlay.Team
         * @instance
         */
        Team.prototype.players = $util.emptyArray;

        /**
         * Creates a new Team instance using the specified properties.
         * @function create
         * @memberof overlay.Team
         * @static
         * @param {overlay.Team.$Properties=} [properties] Properties to set
         * @returns {overlay.Team} Team instance
         * @type {{
         *   (properties: overlay.Team.$Shape): overlay.Team & overlay.Team.$Shape;
         *   (properties?: overlay.Team.$Properties): overlay.Team;
         * }}
         */
        Team.create = function(properties) {
            return new Team(properties);
        };

        /**
         * Encodes the specified Team message. Does not implicitly {@link overlay.Team.verify|verify} messages.
         * @function encode
         * @memberof overlay.Team
         * @static
         * @param {overlay.Team.$Properties} message Team message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Team.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId") && message.teamId !== "")
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.teamId);
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId") && message.docId !== "")
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.docId);
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName") && message.teamName !== "")
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.teamName);
            if (message.teamTag != null && $Object.hasOwnProperty.call(message, "teamTag") && message.teamTag !== "")
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.teamTag);
            if (message.teamLogo != null && $Object.hasOwnProperty.call(message, "teamLogo") && message.teamLogo !== "")
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.teamLogo);
            if (message.slot != null && $Object.hasOwnProperty.call(message, "slot") && message.slot !== 0)
                writer.uint32(/* id 6, wireType 0 =*/48).int32(message.slot);
            if (message.placePoints != null && $Object.hasOwnProperty.call(message, "placePoints") && message.placePoints !== 0)
                writer.uint32(/* id 7, wireType 0 =*/56).int32(message.placePoints);
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank") && message.rank !== 0)
                writer.uint32(/* id 8, wireType 0 =*/64).int32(message.rank);
            if (message.wwcd != null && $Object.hasOwnProperty.call(message, "wwcd") && message.wwcd !== 0)
                writer.uint32(/* id 9, wireType 0 =*/72).int32(message.wwcd);
            if (message.matchesPlayed != null && $Object.hasOwnProperty.call(message, "matchesPlayed") && message.matchesPlayed !== 0)
                writer.uint32(/* id 10, wireType 0 =*/80).int32(message.matchesPlayed);
            if (message.players != null && message.players.length)
                for (var i = 0; i < message.players.length; ++i)
                    $root.overlay.Player.encode(message.players[i], writer.uint32(/* id 11, wireType 2 =*/90).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Team message, length delimited. Does not implicitly {@link overlay.Team.verify|verify} messages.
         * @function encodeDelimited
         * @memberof overlay.Team
         * @static
         * @param {overlay.Team.$Properties} message Team message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Team.encodeDelimited = function(message, writer) {
            return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
        };

        /**
         * Decodes a Team message from the specified reader or buffer.
         * @function decode
         * @memberof overlay.Team
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {overlay.Team & overlay.Team.$Shape} Team
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Team.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            var end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.overlay.Team(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.teamId = value;
                        else
                            delete message.teamId;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.docId = value;
                        else
                            delete message.docId;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.teamName = value;
                        else
                            delete message.teamName;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.teamTag = value;
                        else
                            delete message.teamTag;
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.teamLogo = value;
                        else
                            delete message.teamLogo;
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.slot = value;
                        else
                            delete message.slot;
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.placePoints = value;
                        else
                            delete message.placePoints;
                        continue;
                    }
                case 8: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.rank = value;
                        else
                            delete message.rank;
                        continue;
                    }
                case 9: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.wwcd = value;
                        else
                            delete message.wwcd;
                        continue;
                    }
                case 10: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.matchesPlayed = value;
                        else
                            delete message.matchesPlayed;
                        continue;
                    }
                case 11: {
                        if (wireType !== 2)
                            break;
                        if (!(message.players && message.players.length))
                            message.players = [];
                        message.players.push($root.overlay.Player.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Decodes a Team message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof overlay.Team
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {overlay.Team & overlay.Team.$Shape} Team
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Team.decodeDelimited = function(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Team message.
         * @function verify
         * @memberof overlay.Team
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Team.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId"))
                if (!$util.isString(message.teamId))
                    return "teamId: string expected";
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId"))
                if (!$util.isString(message.docId))
                    return "docId: string expected";
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName"))
                if (!$util.isString(message.teamName))
                    return "teamName: string expected";
            if (message.teamTag != null && $Object.hasOwnProperty.call(message, "teamTag"))
                if (!$util.isString(message.teamTag))
                    return "teamTag: string expected";
            if (message.teamLogo != null && $Object.hasOwnProperty.call(message, "teamLogo"))
                if (!$util.isString(message.teamLogo))
                    return "teamLogo: string expected";
            if (message.slot != null && $Object.hasOwnProperty.call(message, "slot"))
                if (!$util.isInteger(message.slot))
                    return "slot: integer expected";
            if (message.placePoints != null && $Object.hasOwnProperty.call(message, "placePoints"))
                if (!$util.isInteger(message.placePoints))
                    return "placePoints: integer expected";
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank"))
                if (!$util.isInteger(message.rank))
                    return "rank: integer expected";
            if (message.wwcd != null && $Object.hasOwnProperty.call(message, "wwcd"))
                if (!$util.isInteger(message.wwcd))
                    return "wwcd: integer expected";
            if (message.matchesPlayed != null && $Object.hasOwnProperty.call(message, "matchesPlayed"))
                if (!$util.isInteger(message.matchesPlayed))
                    return "matchesPlayed: integer expected";
            if (message.players != null && $Object.hasOwnProperty.call(message, "players")) {
                if (!$Array.isArray(message.players))
                    return "players: array expected";
                for (var i = 0; i < message.players.length; ++i) {
                    var error = $root.overlay.Player.verify(message.players[i], _depth + 1);
                    if (error)
                        return "players." + error;
                }
            }
            return null;
        };

        /**
         * Creates a Team message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof overlay.Team
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {overlay.Team} Team
         */
        Team.fromObject = function (object, _depth) {
            if (object instanceof $root.overlay.Team)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".overlay.Team: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var message = new $root.overlay.Team();
            if (object.teamId != null)
                if (typeof object.teamId !== "string" || object.teamId.length)
                    message.teamId = $String(object.teamId);
            if (object.docId != null)
                if (typeof object.docId !== "string" || object.docId.length)
                    message.docId = $String(object.docId);
            if (object.teamName != null)
                if (typeof object.teamName !== "string" || object.teamName.length)
                    message.teamName = $String(object.teamName);
            if (object.teamTag != null)
                if (typeof object.teamTag !== "string" || object.teamTag.length)
                    message.teamTag = $String(object.teamTag);
            if (object.teamLogo != null)
                if (typeof object.teamLogo !== "string" || object.teamLogo.length)
                    message.teamLogo = $String(object.teamLogo);
            if (object.slot != null)
                if ($Number(object.slot) !== 0)
                    message.slot = object.slot | 0;
            if (object.placePoints != null)
                if ($Number(object.placePoints) !== 0)
                    message.placePoints = object.placePoints | 0;
            if (object.rank != null)
                if ($Number(object.rank) !== 0)
                    message.rank = object.rank | 0;
            if (object.wwcd != null)
                if ($Number(object.wwcd) !== 0)
                    message.wwcd = object.wwcd | 0;
            if (object.matchesPlayed != null)
                if ($Number(object.matchesPlayed) !== 0)
                    message.matchesPlayed = object.matchesPlayed | 0;
            if (object.players) {
                if (!$Array.isArray(object.players))
                    throw $TypeError(".overlay.Team.players: array expected");
                message.players = $Array(object.players.length);
                for (var i = 0; i < object.players.length; ++i) {
                    if (!$util.isObject(object.players[i]))
                        throw $TypeError(".overlay.Team.players: object expected");
                    message.players[i] = $root.overlay.Player.fromObject(object.players[i], _depth + 1);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from a Team message. Also converts values to other types if specified.
         * @function toObject
         * @memberof overlay.Team
         * @static
         * @param {overlay.Team} message Team
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Team.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.players = [];
            if (options.defaults) {
                object.teamId = "";
                object.docId = "";
                object.teamName = "";
                object.teamTag = "";
                object.teamLogo = "";
                object.slot = 0;
                object.placePoints = 0;
                object.rank = 0;
                object.wwcd = 0;
                object.matchesPlayed = 0;
            }
            if (message.teamId != null && $Object.hasOwnProperty.call(message, "teamId"))
                object.teamId = message.teamId;
            if (message.docId != null && $Object.hasOwnProperty.call(message, "docId"))
                object.docId = message.docId;
            if (message.teamName != null && $Object.hasOwnProperty.call(message, "teamName"))
                object.teamName = message.teamName;
            if (message.teamTag != null && $Object.hasOwnProperty.call(message, "teamTag"))
                object.teamTag = message.teamTag;
            if (message.teamLogo != null && $Object.hasOwnProperty.call(message, "teamLogo"))
                object.teamLogo = message.teamLogo;
            if (message.slot != null && $Object.hasOwnProperty.call(message, "slot"))
                object.slot = message.slot;
            if (message.placePoints != null && $Object.hasOwnProperty.call(message, "placePoints"))
                object.placePoints = message.placePoints;
            if (message.rank != null && $Object.hasOwnProperty.call(message, "rank"))
                object.rank = message.rank;
            if (message.wwcd != null && $Object.hasOwnProperty.call(message, "wwcd"))
                object.wwcd = message.wwcd;
            if (message.matchesPlayed != null && $Object.hasOwnProperty.call(message, "matchesPlayed"))
                object.matchesPlayed = message.matchesPlayed;
            if (message.players && message.players.length) {
                object.players = $Array(message.players.length);
                for (var j = 0; j < message.players.length; ++j)
                    object.players[j] = $root.overlay.Player.toObject(message.players[j], options, _depth + 1);
            }
            return object;
        };

        /**
         * Converts this Team to JSON.
         * @function toJSON
         * @memberof overlay.Team
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Team.prototype.toJSON = function() {
            return Team.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Team
         * @function getTypeUrl
         * @memberof overlay.Team
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Team.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/overlay.Team";
        };

        return Team;
    })();

    overlay.MatchDataPayload = (function() {

        /**
         * Properties of a MatchDataPayload.
         * @typedef {Object} overlay.MatchDataPayload.$Properties
         * @property {string|null} [matchId] MatchDataPayload matchId
         * @property {Array.<overlay.Team.$Properties>|null} [teams] MatchDataPayload teams
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a MatchDataPayload.
         * @memberof overlay
         * @interface IMatchDataPayload
         * @augments overlay.MatchDataPayload.$Properties
         * @deprecated Use overlay.MatchDataPayload.$Properties instead.
         */

        /**
         * Shape of a MatchDataPayload.
         * @typedef {overlay.MatchDataPayload.$Properties} overlay.MatchDataPayload.$Shape
         */

        /**
         * Constructs a new MatchDataPayload.
         * @memberof overlay
         * @classdesc Represents a MatchDataPayload.
         * @constructor
         * @param {overlay.MatchDataPayload.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        var MatchDataPayload = function (properties) {
            this.teams = [];
            if (properties)
                for (var keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * MatchDataPayload matchId.
         * @member {string} matchId
         * @memberof overlay.MatchDataPayload
         * @instance
         */
        MatchDataPayload.prototype.matchId = "";

        /**
         * MatchDataPayload teams.
         * @member {Array.<overlay.Team.$Properties>} teams
         * @memberof overlay.MatchDataPayload
         * @instance
         */
        MatchDataPayload.prototype.teams = $util.emptyArray;

        /**
         * Creates a new MatchDataPayload instance using the specified properties.
         * @function create
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {overlay.MatchDataPayload.$Properties=} [properties] Properties to set
         * @returns {overlay.MatchDataPayload} MatchDataPayload instance
         * @type {{
         *   (properties: overlay.MatchDataPayload.$Shape): overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape;
         *   (properties?: overlay.MatchDataPayload.$Properties): overlay.MatchDataPayload;
         * }}
         */
        MatchDataPayload.create = function(properties) {
            return new MatchDataPayload(properties);
        };

        /**
         * Encodes the specified MatchDataPayload message. Does not implicitly {@link overlay.MatchDataPayload.verify|verify} messages.
         * @function encode
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {overlay.MatchDataPayload.$Properties} message MatchDataPayload message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MatchDataPayload.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId") && message.matchId !== "")
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.matchId);
            if (message.teams != null && message.teams.length)
                for (var i = 0; i < message.teams.length; ++i)
                    $root.overlay.Team.encode(message.teams[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified MatchDataPayload message, length delimited. Does not implicitly {@link overlay.MatchDataPayload.verify|verify} messages.
         * @function encodeDelimited
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {overlay.MatchDataPayload.$Properties} message MatchDataPayload message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MatchDataPayload.encodeDelimited = function(message, writer) {
            return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
        };

        /**
         * Decodes a MatchDataPayload message from the specified reader or buffer.
         * @function decode
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape} MatchDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MatchDataPayload.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            var end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.overlay.MatchDataPayload(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.matchId = value;
                        else
                            delete message.matchId;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.teams && message.teams.length))
                            message.teams = [];
                        message.teams.push($root.overlay.Team.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Decodes a MatchDataPayload message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape} MatchDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MatchDataPayload.decodeDelimited = function(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a MatchDataPayload message.
         * @function verify
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        MatchDataPayload.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId"))
                if (!$util.isString(message.matchId))
                    return "matchId: string expected";
            if (message.teams != null && $Object.hasOwnProperty.call(message, "teams")) {
                if (!$Array.isArray(message.teams))
                    return "teams: array expected";
                for (var i = 0; i < message.teams.length; ++i) {
                    var error = $root.overlay.Team.verify(message.teams[i], _depth + 1);
                    if (error)
                        return "teams." + error;
                }
            }
            return null;
        };

        /**
         * Creates a MatchDataPayload message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {overlay.MatchDataPayload} MatchDataPayload
         */
        MatchDataPayload.fromObject = function (object, _depth) {
            if (object instanceof $root.overlay.MatchDataPayload)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".overlay.MatchDataPayload: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var message = new $root.overlay.MatchDataPayload();
            if (object.matchId != null)
                if (typeof object.matchId !== "string" || object.matchId.length)
                    message.matchId = $String(object.matchId);
            if (object.teams) {
                if (!$Array.isArray(object.teams))
                    throw $TypeError(".overlay.MatchDataPayload.teams: array expected");
                message.teams = $Array(object.teams.length);
                for (var i = 0; i < object.teams.length; ++i) {
                    if (!$util.isObject(object.teams[i]))
                        throw $TypeError(".overlay.MatchDataPayload.teams: object expected");
                    message.teams[i] = $root.overlay.Team.fromObject(object.teams[i], _depth + 1);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from a MatchDataPayload message. Also converts values to other types if specified.
         * @function toObject
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {overlay.MatchDataPayload} message MatchDataPayload
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        MatchDataPayload.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.teams = [];
            if (options.defaults)
                object.matchId = "";
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId"))
                object.matchId = message.matchId;
            if (message.teams && message.teams.length) {
                object.teams = $Array(message.teams.length);
                for (var j = 0; j < message.teams.length; ++j)
                    object.teams[j] = $root.overlay.Team.toObject(message.teams[j], options, _depth + 1);
            }
            return object;
        };

        /**
         * Converts this MatchDataPayload to JSON.
         * @function toJSON
         * @memberof overlay.MatchDataPayload
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        MatchDataPayload.prototype.toJSON = function() {
            return MatchDataPayload.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for MatchDataPayload
         * @function getTypeUrl
         * @memberof overlay.MatchDataPayload
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        MatchDataPayload.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/overlay.MatchDataPayload";
        };

        return MatchDataPayload;
    })();

    overlay.OverallDataPayload = (function() {

        /**
         * Properties of an OverallDataPayload.
         * @typedef {Object} overlay.OverallDataPayload.$Properties
         * @property {string|null} [tournamentId] OverallDataPayload tournamentId
         * @property {string|null} [roundId] OverallDataPayload roundId
         * @property {string|null} [matchId] OverallDataPayload matchId
         * @property {Array.<overlay.Team.$Properties>|null} [teams] OverallDataPayload teams
         * @property {string|null} [createdAt] OverallDataPayload createdAt
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of an OverallDataPayload.
         * @memberof overlay
         * @interface IOverallDataPayload
         * @augments overlay.OverallDataPayload.$Properties
         * @deprecated Use overlay.OverallDataPayload.$Properties instead.
         */

        /**
         * Shape of an OverallDataPayload.
         * @typedef {overlay.OverallDataPayload.$Properties} overlay.OverallDataPayload.$Shape
         */

        /**
         * Constructs a new OverallDataPayload.
         * @memberof overlay
         * @classdesc Represents an OverallDataPayload.
         * @constructor
         * @param {overlay.OverallDataPayload.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        var OverallDataPayload = function (properties) {
            this.teams = [];
            if (properties)
                for (var keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * OverallDataPayload tournamentId.
         * @member {string} tournamentId
         * @memberof overlay.OverallDataPayload
         * @instance
         */
        OverallDataPayload.prototype.tournamentId = "";

        /**
         * OverallDataPayload roundId.
         * @member {string} roundId
         * @memberof overlay.OverallDataPayload
         * @instance
         */
        OverallDataPayload.prototype.roundId = "";

        /**
         * OverallDataPayload matchId.
         * @member {string} matchId
         * @memberof overlay.OverallDataPayload
         * @instance
         */
        OverallDataPayload.prototype.matchId = "";

        /**
         * OverallDataPayload teams.
         * @member {Array.<overlay.Team.$Properties>} teams
         * @memberof overlay.OverallDataPayload
         * @instance
         */
        OverallDataPayload.prototype.teams = $util.emptyArray;

        /**
         * OverallDataPayload createdAt.
         * @member {string} createdAt
         * @memberof overlay.OverallDataPayload
         * @instance
         */
        OverallDataPayload.prototype.createdAt = "";

        /**
         * Creates a new OverallDataPayload instance using the specified properties.
         * @function create
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {overlay.OverallDataPayload.$Properties=} [properties] Properties to set
         * @returns {overlay.OverallDataPayload} OverallDataPayload instance
         * @type {{
         *   (properties: overlay.OverallDataPayload.$Shape): overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape;
         *   (properties?: overlay.OverallDataPayload.$Properties): overlay.OverallDataPayload;
         * }}
         */
        OverallDataPayload.create = function(properties) {
            return new OverallDataPayload(properties);
        };

        /**
         * Encodes the specified OverallDataPayload message. Does not implicitly {@link overlay.OverallDataPayload.verify|verify} messages.
         * @function encode
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {overlay.OverallDataPayload.$Properties} message OverallDataPayload message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OverallDataPayload.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.tournamentId != null && $Object.hasOwnProperty.call(message, "tournamentId") && message.tournamentId !== "")
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.tournamentId);
            if (message.roundId != null && $Object.hasOwnProperty.call(message, "roundId") && message.roundId !== "")
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.roundId);
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId") && message.matchId !== "")
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.matchId);
            if (message.teams != null && message.teams.length)
                for (var i = 0; i < message.teams.length; ++i)
                    $root.overlay.Team.encode(message.teams[i], writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt") && message.createdAt !== "")
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.createdAt);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified OverallDataPayload message, length delimited. Does not implicitly {@link overlay.OverallDataPayload.verify|verify} messages.
         * @function encodeDelimited
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {overlay.OverallDataPayload.$Properties} message OverallDataPayload message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OverallDataPayload.encodeDelimited = function(message, writer) {
            return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
        };

        /**
         * Decodes an OverallDataPayload message from the specified reader or buffer.
         * @function decode
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape} OverallDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        OverallDataPayload.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            var end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.overlay.OverallDataPayload(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.tournamentId = value;
                        else
                            delete message.tournamentId;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.roundId = value;
                        else
                            delete message.roundId;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.matchId = value;
                        else
                            delete message.matchId;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if (!(message.teams && message.teams.length))
                            message.teams = [];
                        message.teams.push($root.overlay.Team.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.stringVerify()).length)
                            message.createdAt = value;
                        else
                            delete message.createdAt;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Decodes an OverallDataPayload message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape} OverallDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        OverallDataPayload.decodeDelimited = function(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an OverallDataPayload message.
         * @function verify
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        OverallDataPayload.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.tournamentId != null && $Object.hasOwnProperty.call(message, "tournamentId"))
                if (!$util.isString(message.tournamentId))
                    return "tournamentId: string expected";
            if (message.roundId != null && $Object.hasOwnProperty.call(message, "roundId"))
                if (!$util.isString(message.roundId))
                    return "roundId: string expected";
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId"))
                if (!$util.isString(message.matchId))
                    return "matchId: string expected";
            if (message.teams != null && $Object.hasOwnProperty.call(message, "teams")) {
                if (!$Array.isArray(message.teams))
                    return "teams: array expected";
                for (var i = 0; i < message.teams.length; ++i) {
                    var error = $root.overlay.Team.verify(message.teams[i], _depth + 1);
                    if (error)
                        return "teams." + error;
                }
            }
            if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt"))
                if (!$util.isString(message.createdAt))
                    return "createdAt: string expected";
            return null;
        };

        /**
         * Creates an OverallDataPayload message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {overlay.OverallDataPayload} OverallDataPayload
         */
        OverallDataPayload.fromObject = function (object, _depth) {
            if (object instanceof $root.overlay.OverallDataPayload)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".overlay.OverallDataPayload: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var message = new $root.overlay.OverallDataPayload();
            if (object.tournamentId != null)
                if (typeof object.tournamentId !== "string" || object.tournamentId.length)
                    message.tournamentId = $String(object.tournamentId);
            if (object.roundId != null)
                if (typeof object.roundId !== "string" || object.roundId.length)
                    message.roundId = $String(object.roundId);
            if (object.matchId != null)
                if (typeof object.matchId !== "string" || object.matchId.length)
                    message.matchId = $String(object.matchId);
            if (object.teams) {
                if (!$Array.isArray(object.teams))
                    throw $TypeError(".overlay.OverallDataPayload.teams: array expected");
                message.teams = $Array(object.teams.length);
                for (var i = 0; i < object.teams.length; ++i) {
                    if (!$util.isObject(object.teams[i]))
                        throw $TypeError(".overlay.OverallDataPayload.teams: object expected");
                    message.teams[i] = $root.overlay.Team.fromObject(object.teams[i], _depth + 1);
                }
            }
            if (object.createdAt != null)
                if (typeof object.createdAt !== "string" || object.createdAt.length)
                    message.createdAt = $String(object.createdAt);
            return message;
        };

        /**
         * Creates a plain object from an OverallDataPayload message. Also converts values to other types if specified.
         * @function toObject
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {overlay.OverallDataPayload} message OverallDataPayload
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        OverallDataPayload.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.teams = [];
            if (options.defaults) {
                object.tournamentId = "";
                object.roundId = "";
                object.matchId = "";
                object.createdAt = "";
            }
            if (message.tournamentId != null && $Object.hasOwnProperty.call(message, "tournamentId"))
                object.tournamentId = message.tournamentId;
            if (message.roundId != null && $Object.hasOwnProperty.call(message, "roundId"))
                object.roundId = message.roundId;
            if (message.matchId != null && $Object.hasOwnProperty.call(message, "matchId"))
                object.matchId = message.matchId;
            if (message.teams && message.teams.length) {
                object.teams = $Array(message.teams.length);
                for (var j = 0; j < message.teams.length; ++j)
                    object.teams[j] = $root.overlay.Team.toObject(message.teams[j], options, _depth + 1);
            }
            if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt"))
                object.createdAt = message.createdAt;
            return object;
        };

        /**
         * Converts this OverallDataPayload to JSON.
         * @function toJSON
         * @memberof overlay.OverallDataPayload
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        OverallDataPayload.prototype.toJSON = function() {
            return OverallDataPayload.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for OverallDataPayload
         * @function getTypeUrl
         * @memberof overlay.OverallDataPayload
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        OverallDataPayload.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/overlay.OverallDataPayload";
        };

        return OverallDataPayload;
    })();

    return overlay;
})();

module.exports = $root;
