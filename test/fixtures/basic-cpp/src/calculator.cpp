#include "calculator.hpp"

int Calculator::add(int left, int right) const {
    return left + right;
}

int Calculator::sumTo(int value) const {
    if (value <= 0) {
        return 0;
    }
    return add(value, sumTo(value - 1));
}
