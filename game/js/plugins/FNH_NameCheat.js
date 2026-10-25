/*:
 * @plugindesc Bất tử và sát thương lớn cho nhân vật mang tên lighthouse.
 * @help
 * Đặt tên nhân vật là lighthouse (không phân biệt hoa thường).
 * Nhân vật luôn đầy HP, miễn trạng thái chết và gây ít nhất 9999 sát thương
 * bằng đòn gây mất/hút HP trúng quái. Đổi tên khác để tắt.
 * Đặt plugin này cuối danh sách để áp dụng sau các plugin chiến đấu.
 * Không thay đổi các kết thúc được sự kiện cốt truyện gọi trực tiếp.
 */
(function () {
    'use strict';

    function hasCheat(actor) {
        return actor.isActor() && actor.name().trim().toLowerCase() === 'lighthouse';
    }

    var setName = Game_Actor.prototype.setName;
    Game_Actor.prototype.setName = function (name) {
        setName.call(this, name);
        if (hasCheat(this)) this.refresh();
    };

    var refresh = Game_Actor.prototype.refresh;
    Game_Actor.prototype.refresh = function () {
        // Chặn chết trước khi runtime kiểm tra HP và trạng thái.
        if (hasCheat(this)) {
            this._hp = this.mhp;
            this.eraseState(this.deathStateId());
        }
        refresh.call(this);
        // Các plugin chỉ số có thể tính lại HP tối đa trong refresh.
        if (hasCheat(this)) this._hp = this.mhp;
    };

    var isStateResist = Game_Actor.prototype.isStateResist;
    Game_Actor.prototype.isStateResist = function (stateId) {
        if (hasCheat(this) && stateId === this.deathStateId()) return true;
        return isStateResist.call(this, stateId);
    };

    var die = Game_Actor.prototype.die;
    Game_Actor.prototype.die = function () {
        if (hasCheat(this)) {
            this.refresh();
            return;
        }
        die.call(this);
    };

    var makeDamageValue = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function (target, critical) {
        var value = makeDamageValue.call(this, target, critical);
        if (hasCheat(this.subject()) && target.isEnemy() && this.isHpEffect() &&
                (this.isDamage() || this.isDrain())) {
            return Math.max(9999, value);
        }
        return value;
    };
})();
